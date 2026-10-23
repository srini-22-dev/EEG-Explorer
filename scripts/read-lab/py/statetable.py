"""The row table for a STATE: a learningeeg figure against the engine, both read the same way.

For each reference figure (REFS below — geometry measured, montage read off its labels, windows
chosen to exclude artifacts, all recorded here), render the engine:
  - in the figure's channel order (the 18 derivations the engine has; T1/T2 rows are skipped),
  - at a px/s and row pitch that, after downscaling by pitch/40 exactly as the figure's own screenshot
    was scaled, equal the figure's — so the reader's small-pitch bias applies to both sides alike,
  - at a sensitivity that matches the figure's median row occupancy,
  - over several subjects,
and read both with rowtable.read_page. A row is flagged only when the reference lies outside the
engine's subject spread by more than the reader's error at that geometry (TOL, from the bench at 27 px
pitch, antialiased: 90th-percentile |read - truth|).

    python statetable.py awake-closure2        # one figure
    python statetable.py all
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rowtable as R

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))   # scripts/
ONLINE = os.path.join(HERE, '..', 'corpus', 'online')
LE22 = ['Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2',
        'Fp1-F7', 'F7-T3', 'T3-T5', 'T5-O1', 'Fp2-F8', 'F8-T4', 'T4-T6', 'T6-O2',
        'F7-T1', 'T1-T3', 'F8-T2', 'T2-T4', 'Fz-Cz', 'Cz-Pz']
LE_GROUPS = [4, 4, 4, 4, 2, 2, 2]
SHARED = [l for l in LE22 if 'T1' not in l and 'T2' not in l]
SEEDS = [3, 42, 777, 1234, 5, 11]
TOL = dict(rel=0.18, delta=0.18, theta=0.07, alpha=0.07, beta=0.15)

# Reference figures. px/s from the grid period, cross-checked against the ECG heart rate; pitch from
# the comb fit; windows exclude the eye movements, blinks, muscle and movement named in each note.
REFS = {
    'awake-closure2': dict(img='eye-closure-2.png', state='awake', pxps=111, pitch=27.5, lblw=62,
        win=[(700, 1160)], note='learningeeg Normal Awake, normal-alpha-eye-closure ("The PDR is 10"): '
        'eyes-closed stretch between the closure (x~670) and the opening (x~1180).'),
    'awake-closure1': dict(img='eye-closure.png', state='awake', pxps=91, pitch=23.0, lblw=58,
        win=[(790, 1220), (1290, 1590)], note='learningeeg Normal Awake, pdr-emerges-eye-closure: after '
        'the closure (x~526), skipping the movement/muscle event at x~700-790 and x~1220-1290.'),
    'awake-alpha': dict(img='term-alpha.png', state='awake', pxps=135, pitch=27.0, lblw=62,
        win=[(360, 1140)], note='learningeeg Atlas, alpha activity: between the blink (x~300) and the '
        'eye movements after x~1150.'),
    'n1-vertex': dict(img='vertex-wave.png', state='n1', pxps=111, pitch=30.5, lblw=62,
        win=None, note='learningeeg Normal Asleep, Vertex wave ("characteristic of stage I sleep"); '
        'whole page.'),
    'n2-kc': dict(img='kc-spindles-posts.png', state='n2', pxps=104, pitch=22.0, lblw=95,
        win=None, note='learningeeg Normal Asleep, K complex ("characteristic of stage II sleep"); '
        'whole page.'),
    'n3-sws': dict(img='sws.png', state='n3', pxps=111, pitch=26.5, lblw=62,
        win=None, note='learningeeg Normal Asleep, Slow Wave Sleep I; whole page. Occupancy is above '
        '1 row-height: aggregate claims only (read skill).'),
}


def render_engine(state, seed, pxps, pitch, sens, out, seconds=12):
    k = pitch / 40.0                       # engine rows are 40 px; the screenshot's are `pitch`
    speed = pxps / k / 4.0                 # after downscaling by k, px/s == pxps
    chans = ','.join(SHARED) + ',ECG'
    png, tj = out + '.png', out + '.json'
    subprocess.run(['pnpm', 'exec', 'tsx', './src/renderClinicalPage.ts', '--state', state,
                    '--channels', chans, '--seconds', str(seconds), '--seed', str(seed), '--skip', '20',
                    '--speed', f'{speed:.4f}', '--sensitivity', f'{sens:.3f}', '--out', png, '--truth', tj],
                   cwd=ROOT, check=True, capture_output=True, shell=True)
    t = json.load(open(tj))
    im = Image.open(png).convert('RGB')
    im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS).save(png)
    rows = [r for r in t['rows'] if not r.get('ecg')]
    res = R.read_page(png, [r['label'] for r in rows], None, round(t['labelStripPx'] * k), pxps,
                      baselines=[r['baselineY'] * k for r in rows], pitch=pitch)
    res['truth'] = {r['label']: r['share'] for r in rows}
    return res, float(np.median([r['rowHeights'] for r in rows]))


def table(key, seeds=SEEDS):
    ref = REFS[key]
    img = os.path.join(ONLINE, ref['img'])
    W = Image.open(img).size[0]
    rres = R.read_page(img, LE22, LE_GROUPS, ref['lblw'], ref['pxps'], windows=ref['win'] or [(ref['lblw'], W)],
                       pmin=ref['pitch'] - 2, pmax=ref['pitch'] + 2, norm_rows=SHARED)
    occ = rres['occupancy']
    tmp = tempfile.mkdtemp(prefix='statetable-')
    # Match occupancy: a pilot at 7 uV/mm on the first seed sets the sensitivity for all seeds.
    _, truth_occ = render_engine(ref['state'], seeds[0], ref['pxps'], ref['pitch'], 7, os.path.join(tmp, 'pilot'))
    sens = 7 * truth_occ / occ
    eng = [render_engine(ref['state'], s, ref['pxps'], ref['pitch'], sens, os.path.join(tmp, f's{s}'))[0] for s in seeds]
    print(f"\n## {key}  ({ref['note']})")
    print(f"reference median row {occ:.2f} row-heights, pitch {rres['pitch']:.1f}px; engine {ref['state']}, "
          f"{len(seeds)} subjects at {sens:.1f} uV/mm (occupancy matched)")
    print('row       | rel ref  eng(mean±sd) | delta ref eng | theta ref eng | alpha ref eng | beta ref eng | alpha dB ref eng | flags')
    flags_all = []
    for lab in SHARED:
        rr = rres['rows'][lab]
        e = lambda f: np.array([f(x['rows'][lab]) for x in eng])
        cells, flags = [], []
        rel = e(lambda r: r['rel'])
        cells.append(f"{rr['rel']:4.2f}  {rel.mean():4.2f}±{rel.std():.2f}")
        if abs(rr['rel'] - rel.mean()) > TOL['rel'] + 2 * rel.std():
            flags.append(f"rel {'eng high' if rel.mean() > rr['rel'] else 'eng low'}")
        for b in ('delta', 'theta', 'alpha', 'beta'):
            v = e(lambda r, b=b: r['share'][b])
            cells.append(f"{rr['share'][b]:.2f} {v.mean():.2f}")
            if abs(rr['share'][b] - v.mean()) > TOL[b] + 2 * v.std():
                flags.append(f"{b} {'eng high' if v.mean() > rr['share'][b] else 'eng low'}")
        tr = {b: np.mean([x['truth'][lab][b] for x in eng]) for b in ('delta', 'alpha')}
        cells.append(f"truth d{tr['delta']:.2f} a{tr['alpha']:.2f}")
        adb = e(lambda r: r['adb'])
        cells.append(f"{rr['adb']:5.1f} {adb.mean():5.1f}")
        print(f"{lab:9s} | " + ' | '.join(cells) + ' | ' + ', '.join(flags))
        flags_all += [(lab, f) for f in flags]
    return dict(key=key, occupancy=occ, sens=sens, flags=flags_all)


if __name__ == '__main__':
    keys = list(REFS) if sys.argv[1] == 'all' else sys.argv[1:]
    out = [table(k) for k in keys]
    print('\nFLAGS')
    for o in out:
        print(o['key'], o['flags'] if o['flags'] else 'none')
