import { SLEEP_OPTS, bandPower, base, check, runEngineState, section, step } from './harness';

step('\n=== Step 14: chewing artifact (pattern source) ===\n');

section(null, () => {
  const chew = runEngineState(150, SLEEP_OPTS, 'awake', ['chewing']);
  const hf = (r: typeof base, n: string) => bandPower(r.data[r.eng.indexOf(n)], 15, 60);
  // Chewing's burst + masseter EMG is broadband/high-frequency; look well above
  // the neural bands at both temporal electrodes, on vs. off.
  const temporalOn = (hf(chew, 'T3') + hf(chew, 'T4')) / 2;
  const temporalOff = (hf(base, 'T3') + hf(base, 'T4')) / 2;
  check('temporal (T3/T4) high-freq power, chewing on/off', temporalOn / temporalOff, 4, 500);
  // Temporal-predominant: bilateral masseter sources dwarf a midline electrode.
  check('temporal / midline (Cz) high-freq power, chewing on', temporalOn / hf(chew, 'Cz'), 2.5, 200);
});
