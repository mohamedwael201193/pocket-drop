// Everything below the fold, as its own chunk.
import { Break } from './sections/Break';
import { FinalCta } from './sections/FinalCta';
import { Footer } from './sections/Footer';
import { Judges } from './sections/Judges';
import { Proof } from './sections/Proof';
import { Qday } from './sections/Qday';
import { Story } from './sections/Story';

export default function Rest() {
  return (
    <>
      <Story />
      <Break />
      <Qday />
      <Proof />
      <Judges />
      <FinalCta />
      <Footer />
    </>
  );
}
