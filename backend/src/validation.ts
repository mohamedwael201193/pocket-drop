import { z } from 'zod';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { PK_BYTES, SIG_BYTES } from './config.js';

const hexOfBytes = (bytes: number, label: string) =>
  z
    .string()
    .regex(/^0x[0-9a-fA-F]*$/, `${label} must be 0x-prefixed hex`)
    .refine((v) => v.length === 2 + bytes * 2, `${label} must be exactly ${bytes} bytes`)
    .transform((v) => v as Hex);

export const linkIdSchema = z
  .union([z.string().regex(/^\d{1,78}$/, 'linkId must be a decimal integer'), z.number().int().nonnegative().safe()])
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n && v < 2n ** 256n, 'linkId must be in 1..2^256-1');

/** All-lowercase / all-uppercase hex is accepted; mixed case must carry a valid EIP-55 checksum. */
export const addressSchema = z
  .string()
  .refine((v) => isAddress(v, { strict: true }), 'invalid address or bad EIP-55 checksum')
  .transform((v) => getAddress(v) as Address);

export const bindSchema = z
  .object({
    linkId: linkIdSchema,
    recipient: addressSchema,
    recipientKeyHash: hexOfBytes(32, 'recipientKeyHash'),
    linkPk: hexOfBytes(PK_BYTES, 'linkPk'),
    linkSig: hexOfBytes(SIG_BYTES, 'linkSig'),
  })
  .strict();

export const claimSchema = z
  .object({
    linkId: linkIdSchema,
    recipientSig: hexOfBytes(SIG_BYTES, 'recipientSig'),
  })
  .strict();

export type BindInput = z.infer<typeof bindSchema>;
export type ClaimInput = z.infer<typeof claimSchema>;

export function formatIssues(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/* ---------- v4: POST /api/route ---------- */

const MAX_ROUTE_DATA_BYTES = 64 * 1024;
const uint = (label: string, bits: number) =>
  z.union([z.string().regex(/^\d{1,78}$/, `${label} must be a decimal integer`), z.number().int().nonnegative().safe()])
    .transform((v) => BigInt(v))
    .refine((v) => v < 2n ** BigInt(bits), `${label} must fit in ${bits} bits`);

export const pocketConfigSchema = z
  .object({
    owner: addressSchema,
    guardians: z.array(addressSchema).max(5),
    threshold: z.number().int().min(0).max(5),
    dailyLimit: uint('dailyLimit', 256),
    userSalt: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'userSalt must be 32 bytes of hex').transform((v) => v as Hex),
  })
  .strict();

export const routeSchema = z
  .object({
    env: z.enum(['prod', 'lab', 'prodV4', 'labV4']).default('prod'),
    /** Forward `data` to this Pocket, PocketDrop or DropPool (router.relay). Omit when `pocket` is given. */
    target: addressSchema.optional(),
    /** Lazy deployment: deploy this Pocket config first if it does not exist yet (router.deployAndRelay). */
    pocket: pocketConfigSchema.optional(),
    data: z
      .string()
      .regex(/^0x([0-9a-fA-F]{2})*$/, 'data must be 0x-prefixed hex of whole bytes')
      .refine((v) => (v.length - 2) / 2 <= MAX_ROUTE_DATA_BYTES, `data is limited to ${MAX_ROUTE_DATA_BYTES} bytes`)
      .transform((v) => v as Hex)
      .default('0x'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.pocket && !v.target) ctx.addIssue({ code: 'custom', path: ['target'], message: 'target is required unless pocket is given' });
    if (v.pocket && v.target) ctx.addIssue({ code: 'custom', path: ['target'], message: 'give either target or pocket, not both' });
    if (!v.pocket && v.data === '0x') ctx.addIssue({ code: 'custom', path: ['data'], message: 'data is required when relaying to a target' });
  });

export type RouteInput = z.infer<typeof routeSchema>;
