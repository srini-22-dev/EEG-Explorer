"""Score a blind read against the truth it was not allowed to see.

    python score.py ../corpus/blind-answers-2026-09-10.json

Per page: montage, state (exact, and "adjacent" along awake-drowsy-n1-n2-n3), PDR
present, PDR frequency, and toggled patterns (hits, misses, false alarms). "PDR
drawn" is defined from what the page actually drew, not from the state label: the
O1/O2-bearing rows' alpha share >= 0.3 with their drawn peak in 8-13 Hz.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TRUTH = os.path.join(HERE, '..', 'corpus', 'blind-truth')
ORDER = ['awake', 'drowsy', 'n1', 'n2', 'n3']


def pdr_drawn(t):
    post = [r for r in t['rows'] if 'O1' in r['label'].split('-') or 'O2' in r['label'].split('-')]
    share = sum(r['bandShare']['alpha'] for r in post) / len(post)
    peak = sum(r['alphaPeakHz'] for r in post) / len(post)
    return share >= 0.3 and 8 <= peak <= 13, share, peak


def main(path):
    A = json.load(open(path))['answers']
    n = dict(montage=0, state=0, adjacent=0, pdr=0, pages=0, hits=0, misses=0, fa=0)
    ferr = []
    print(f'{"id":<9} {"montage (read / true)":<38} {"state":<14} {"PDR read/drawn":<22} patterns read -> true')
    for pid, a in A.items():
        t = json.load(open(os.path.join(TRUTH, pid + '.json')))
        n['pages'] += 1
        mon = a['montage'] == t['montage']
        st = a['state'] == t['state']
        adj = st or (a['state'] in ORDER and t['state'] in ORDER
                     and abs(ORDER.index(a['state']) - ORDER.index(t['state'])) == 1)
        drawn, share, peak = pdr_drawn(t)
        pd = a['pdr'] == drawn
        if a['pdr'] and drawn and a.get('pdr_hz'):
            ferr.append(abs(a['pdr_hz'] - peak))
        rp, tp = set(a['patterns']), set(t['patterns'])
        n['hits'] += len(rp & tp); n['misses'] += len(tp - rp); n['fa'] += len(rp - tp)
        n['montage'] += mon; n['state'] += st; n['adjacent'] += adj; n['pdr'] += pd
        print(f"{pid:<9} {'OK ' if mon else 'XX '}{a['montage'][:16]:<16}/{t['montage'][:16]:<17} "
              f"{'OK ' if st else ('~  ' if adj else 'XX ')}{a['state']:<4}/{t['state']:<5} "
              f"{'OK ' if pd else 'XX '}{str(a['pdr'])[0]}/{str(drawn)[0]} a={share:.2f} {peak:4.1f}Hz  "
              f"{sorted(rp)} -> {sorted(tp)}   [{t['renderer']}, {t['sensitivity']} uV/mm]")
    P = n['pages']
    print(f"\nmontage {n['montage']}/{P}   state exact {n['state']}/{P} (adjacent {n['adjacent']}/{P})   "
          f"PDR {n['pdr']}/{P}   patterns: {n['hits']} hit, {n['misses']} missed, {n['fa']} false alarm"
          + (f"   PDR freq |err| {sum(ferr)/len(ferr):.2f} Hz (n={len(ferr)})" if ferr else ''))


if __name__ == '__main__':
    main(sys.argv[1])
