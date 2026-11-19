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
