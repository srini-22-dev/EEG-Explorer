"""Iteration 1b on REAL figures — the independent test.

The PDR thresholds were set with the engine's scores in view, so the engine can no
longer test them. These five learningeeg figures can: each one's montage was READ
off its label strip (never assumed), its time base taken from the ECG or the 1 s
rules and cross-checked against a physiological heart rate, and its caption
paraphrased into a claim with the measurement that tests it (online.json).

    python iter1_online.py
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract as E
import trackers as T
import pdr

ON = os.path.join(HERE, '..', 'corpus', 'online')

DB = ['Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2',
      'Fp1-F7', 'F7-T3', 'T3-T5', 'T5-O1', 'Fp2-F8', 'F8-T4', 'T4-T6', 'T6-O2',
      'F7-T1', 'T1-T3', 'F8-T2', 'T2-T4', 'Fz-Cz', 'Cz-Pz']
DB_GROUPS = [4, 4, 4, 4, 2, 2, 2]

# What was READ from each figure (2026-09-10). px/s source and its cross-check are
# recorded because a wrong time base silently rescales every frequency.
FIGS = {
    'ap-gradient': dict(labels=['anterior-1', 'anterior-2', 'posterior-2', 'posterior-1'],
                        groups=[4], lblw=0, pxps=400.0,
                        pxps_how='solid 1 s rules 400 px apart; grid_period returns 80 = the dotted 0.2 s lines',
                        expect='pdr', post=[3], front=[0], sides=None),
    'term-alpha': dict(labels=DB, groups=DB_GROUPS, lblw=62, pxps=135.0,
                       pxps_how='grid_period 135; ECG R-R ~116 px -> 70 bpm',
                       expect='pdr'),
    'mu': dict(labels=DB, groups=DB_GROUPS, lblw=58, pxps=104.0,
               pxps_how='grid_period 104; ECG R-R ~77 px -> 81 bpm',
               expect='central-max'),
    'sws': dict(labels=DB, groups=DB_GROUPS, lblw=58, pxps=111.0,
                pxps_how='grid_period 111; ECG R-R ~74 px -> 90 bpm',
                expect='no-pdr'),
    'kc-spindles-posts': dict(labels=DB, groups=DB_GROUPS, lblw=58, pxps=104.0,
                              pxps_how='grid_period 104; ECG R-R ~87 px -> 71 bpm',
                              expect='no-pdr'),
}


def idx(labels, pred):
    return [i for i, l in enumerate(labels) if pred(l)]


def main():
    print('figure             expect        called  post dB  front dB  L/R gap   freq    central dB  verdict')
    out = {}
    for fid, f in FIGS.items():
        png = os.path.join(ON, fid + '.png')
        ink, H, W = E.load_ink(png)                      # black traces; red ECG + blue notes dropped
        pitch_guess = (H / (sum(f['groups']) + 1.5 * len(f['groups'])))
        best = E.comb_fit(ink, H, f['groups'], lblw=f['lblw'],
                          pmin=max(10, 0.6 * pitch_guess), pmax=1.6 * pitch_guess)
        B, pitch = list(best[4]), best[2]
        ys, conf = T.track_segments(ink[:, f['lblw']:], B, pitch)
        L = f['labels']
        post = f.get('post') or idx(L, pdr_side_post)
        front = f.get('front') or idx(L, lambda l: l.split('-')[0] in ('Fp1', 'Fp2'))
        sides = f.get('sides', 'auto')
        if sides == 'auto':
            sides = [pdr.side_of(L[i]) for i in post]
        v = pdr.call_pdr([ys[i] for i in post], [ys[i] for i in front], f['pxps'], sides)
        central = idx(L, lambda l: l in ('F3-C3', 'C3-P3', 'F4-C4', 'C4-P4'))
        cdb = float(np.mean([pdr.alpha_peak(ys[i], f['pxps'])[1] for i in central])) if central else None
        if f['expect'] == 'pdr':
            ok = v['present']
        elif f['expect'] == 'no-pdr':
            ok = not v['present']
        else:   # central-max: alpha-band peak higher centrally than posteriorly
            ok = cdb is not None and cdb > v['post_db']
        gap = '   —  ' if v['lr_gap'] is None else f"{v['lr_gap']:5.2f} "
        fr = '   —  ' if v['freq'] is None else f"{v['freq']:5.2f}"
        cd = '     —' if cdb is None else f'{cdb:6.1f}'
        print(f"{fid:<18} {f['expect']:<12} {str(v['present']):>6}  {v['post_db']:6.1f}   {v['front_db']:6.1f}   {gap}  {fr}   {cd}      "
              f"{'PASS' if ok else 'FAIL'}")
        out[fid] = dict(verdict=v, central_db=cdb, pass_=bool(ok), pitch=pitch,
                        conf=float(conf.mean()), pxps=f['pxps'], pxps_how=f['pxps_how'])
    json.dump(out, open(os.path.join(HERE, '..', 'corpus', 'iter1_online_results.json'), 'w'), indent=1)


def pdr_side_post(label):
    a, _, b = label.partition('-')
    return b in ('O1', 'O2')


if __name__ == '__main__':
    main()
