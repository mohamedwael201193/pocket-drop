// Ready-to-send share texts for the two things a visitor can pass on without an account: the team's sample Drop Pool and
// the Q-Day bait challenge. Nothing is posted by the app: the visitor taps Share / Copy / WhatsApp themselves.
import sample from '../data/sample-pool.json';

export interface ShareSpec { title: string; text: string; url: string }

export const samplePoolShare = (origin: string, slotsLeft?: number | null): ShareSpec => ({
  title: 'Pocket Drop sample pool (testnet)',
  text: `Try receiving ${sample.perSlotQor} testnet QOR with a quantum-safe key made in your browser: no wallet, no seed phrase${slotsLeft != null ? `, ${slotsLeft} slot${slotsLeft === 1 ? '' : 's'} left` : ''}. Diana testnet, no real value.`,
  url: `${origin}${sample.path}`,
});

export const baitShare = (origin: string, pocketCount = 5): ShareSpec => ({
  title: 'Pocket Drop Q-Day Drill (testnet)',
  text: `${pocketCount} testnet Pockets with their classical (secp256k1) keys published, as if a quantum computer had broken them. Take the QOR if you can: the chain only accepts the ML-DSA-87 key. Diana testnet, no real value.`,
  url: `${origin}/qday`,
});

/** One message for apps that take a single text field (WhatsApp, SMS). */
export const shareMessage = (s: ShareSpec) => `${s.text} ${s.url}`;
export const whatsappUrl = (s: ShareSpec) => `https://wa.me/?text=${encodeURIComponent(shareMessage(s))}`;
