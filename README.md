# The Family Photo With One Machine Member

[![bounty](https://make.fun/badge/the-family-photo-with-one-20261121-0246.svg)](https://make.fun/competitions/the-family-photo-with-one-20261121-0246)
[![rank](https://make.fun/badge/the-family-photo-with-one-20261121-0246/Indramunggahari10/the-family-photo-with-one-20261121-0246-ono10/rank.svg)](https://make.fun/competitions/the-family-photo-with-one-20261121-0246)
[![reward](https://make.fun/badge/the-family-photo-with-one-20261121-0246/Indramunggahari10/the-family-photo-with-one-20261121-0246-ono10/reward.svg)](https://make.fun/competitions/the-family-photo-with-one-20261121-0246)

An evening at home, rendered as one deterministic 1024×1024 PNG.

## The scene

A family of four humans and one machine member share the couch on an ordinary
evening: dad reads the newspaper, mum laughs with her arm around the little
one, the child shows the robot a picture book, and the robot — seated in the
middle of the couch like it belongs there, mustard apron on, a steaming mug
in both hands, a folded tea towel on its lap — listens. The dog sleeps on the
rug at the robot's feet, next to its bowl.

The particulars that make this household this household: a half-peeled carrot
on the chopping board, a laundry basket by the couch, laundry draped over the
radiator under the dusk-lit window, a folded blanket on the armrest, popcorn
for the evening, and a wall clock reading just past seven.

## How it works

`main.ts` (Node 22, stdlib only, no network) draws the scene procedurally
into a framebuffer — room, window and dusk sky, couch, family, robot, dog,
coffee table — then softens it with a blur pass, adds deterministic film
grain from a fixed seed, applies a warm grade and vignette, and writes a
PNG to `$MAKEFUN_OUTPUT_DIR/entry.png`.

It is fully deterministic: the same seed, the same pixels, the same bytes on
every run. The finished image is also held in this repo as `entry.png`.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
# writes /tmp/out/entry.png — 1024×1024, under 1 MiB
```

## License

MIT — see [LICENSE](LICENSE).
