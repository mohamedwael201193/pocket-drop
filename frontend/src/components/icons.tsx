/**
 * One icon set for the whole app: Phosphor, duotone weight, named like the Lucide icons they replace
 * so every call site stays the same. Hover and state animation live in index.css (.ph-i, .ph-arrow, .ph-pop).
 */
import { forwardRef, type CSSProperties } from 'react';
import {
  ArrowRight as PArrowRight, ArrowSquareOut, ArrowsClockwise, Broadcast, CaretDown, CaretRight, ChatCircle, Check as PCheck,
  CheckCircle, CircleDashed as PCircleDashed, CircleNotch, Compass as PCompass, Copy as PCopy, Cpu as PCpu, Drop, Eye as PEye,
  EyeSlash, Fingerprint as PFingerprint, Flask, Gift as PGift, Globe as PGlobe, Hexagon as PHexagon, Key, LockSimple, PaperPlaneTilt,
  Play as PPlay, Scales, ShareNetwork, ShieldCheck as PShieldCheck, ShieldSlash, SkipForward as PSkipForward, Tray, Users as PUsers,
  Wallet as PWallet, Warning, XCircle as PXCircle, type Icon as PhIcon, type IconWeight,
} from '@phosphor-icons/react';

export type IconProps = { className?: string; style?: CSSProperties; 'aria-hidden'?: boolean | 'true' | 'false'; 'aria-label'?: string; weight?: IconWeight; strokeWidth?: number };

function mk(I: PhIcon, extra = '', weight: IconWeight = 'duotone') {
  const C = forwardRef<SVGSVGElement, IconProps>(function Icon({ className, strokeWidth: _s, weight: w, ...rest }, ref) {
    void _s;
    return <I ref={ref} weight={w ?? weight} className={['ph-i', extra, className].filter(Boolean).join(' ')} aria-hidden={rest['aria-label'] ? undefined : true} {...rest} />;
  });
  return C;
}

export const ArrowRight = mk(PArrowRight, 'ph-arrow', 'bold');
export const ChevronRight = mk(CaretRight, 'ph-arrow', 'bold');
export const ChevronDown = mk(CaretDown, '', 'bold');
export const ExternalLink = mk(ArrowSquareOut, 'ph-ext', 'bold');
export const Check = mk(PCheck, 'ph-pop', 'bold');
export const CheckCircle2 = mk(CheckCircle, 'ph-pop');
export const XCircle = mk(PXCircle);
export const CircleDashed = mk(PCircleDashed, '', 'bold');
export const Loader2 = mk(CircleNotch, 'ph-spin', 'bold');
export const RefreshCw = mk(ArrowsClockwise, '', 'bold');
export const Copy = mk(PCopy, 'ph-copy');
export const Compass = mk(PCompass);
export const Cpu = mk(PCpu);
export const Droplets = mk(Drop);
export const Eye = mk(PEye);
export const EyeOff = mk(EyeSlash);
export const Fingerprint = mk(PFingerprint);
export const FlaskConical = mk(Flask);
export const Gift = mk(PGift);
export const Globe = mk(PGlobe);
export const Hexagon = mk(PHexagon);
export const Inbox = mk(Tray);
export const KeyRound = mk(Key);
export const Lock = mk(LockSimple);
export const MessageCircle = mk(ChatCircle);
export const Play = mk(PPlay);
export const Radio = mk(Broadcast);
export const Scale = mk(Scales);
export const Send = mk(PaperPlaneTilt);
export const Share2 = mk(ShareNetwork);
export const ShieldCheck = mk(PShieldCheck);
export const ShieldX = mk(ShieldSlash);
export const SkipForward = mk(PSkipForward);
export const TriangleAlert = mk(Warning);
export const Users = mk(PUsers);
export const Wallet = mk(PWallet);
