# Label printer: Brother PT-E550W

The server talks to the printer directly over USB, using Brother's raster protocol
([brother-pt-e550w-raster-reference.pdf](brother-pt-e550w-raster-reference.pdf)). No driver is
installed and no Brother software is needed.

## Connect

1. Plug it into the PC by USB and turn it on. If the printer has a P-touch Editor Lite /
   mass-storage mode, turn it off; the PC must see a printer, not a disk.
2. Check that Linux sees it:
   ```sh
   lsusb | grep -i brother           # 04f9:2060 Brother Industries, Ltd PT-E550W
   ls -l /dev/usb/lp*                # crw-rw---- 1 root lp ... /dev/usb/lp0
   ```
   If `lp0` is missing, run `sudo modprobe usblp`.
3. The container runs with the `lp` group (gid 7) so it can open the device. Check with the
   **Labels** page in the app: it should say *PT-E550W ready* with *12 mm* or *24 mm* tape.

## Labels

Every label code is a letter plus a number: `L` location, `I` item, `S` stock, `A` asset.

| Type | Length on 12 mm* | On 24 mm* | Notes |
|---|---|---|---|
| **Data Matrix** (default) | ≈ 26 mm | ≈ 47 mm | Scan with the app's Scan button. |
| QR | ≈ 25 mm | ≈ 45 mm | Encodes `https://inv.portospaceteam.pt/A107`, so any phone camera opens it. |
| Code128 barcode | ≈ 26 mm | ≈ 26 mm | 1D barcode, with the code under the bars. |

\* For a code like `A107`, including the 2 mm feed margin the printer adds at each end (the
minimum it allows). The symbol fills the height of the tape and the code is printed next to
it in large text (about 5.5 mm tall on 12 mm tape). With a caption (e.g. the location name),
the code and the caption share that space, the caption on one line however long it is: each
character adds about 2 mm of tape on 12 mm (4 mm on 24 mm).

Labels are laid out for whatever tape is loaded when they print: **12 mm** or **24 mm**. On
24 mm the code and text are twice as big, so they read from further away (e.g. on big boxes
and cabinet doors). Previews in the app use the tape the printer last reported.

The default is set with `INVENTARIUS_SYMBOLOGY`; any label can be printed in another format
from its page.

**Saving tape:** every print job feeds about 24.5 mm of tape before the first label, because the
cutter sits away from the print head. The queue therefore waits a few seconds
(`INVENTARIUS_PRINT_BATCH_DELAY`) and prints everything pending as **one job**. Labels in a
job are half-cut, so they come out as a strip that is easy to peel, with one full cut at the
end. To label a whole shelf at once, use *Labels → Print several labels* with a range like
`L4-L20`, or *Print labels…* in a place's menu to tick the place, the places inside it and
its parts and units.

Labels made a minute apart still print one by one, each wasting the lead-in. When labelling a
lot, turn on **Hold labels** on the Labels page: every label waits (the Labels menu entry shows
how many) until you press *Print now*, and they all come out as one strip. Several earlier
labels can also be ticked in *Recent print jobs* and reprinted together.

**Tape left:** the printer cannot report how much tape a TZe cassette has left, so the app
estimates it. It adds up the tape every job uses (lead-in, labels, margins) and shows what is
left on the **Labels** page. Each width (12 or 24 mm) has its own count, so cassettes can be
swapped. When you put in a **new** cassette, press *New tape loaded* and choose its length
(standard TZe: 8 m). Labels printed from the printer's own keyboard are not counted. The
first cassette counted also includes every label the app printed before this existed.

## First print checklist

The protocol code is tested against the spec, but it has not yet run on our printer. On
first use:

- [ ] Print one Data Matrix label and one QR label from any location page.
- [ ] Measure them: about 26 mm and 25 mm long (plus the lead-in on the first label).
- [ ] Scan both with the app and a QR with the normal phone camera.
- [ ] If the text is upside down or mirrored relative to how you'll stick it, set
      `INVENTARIUS_PRINT_FLIP=true`.
- [ ] Print a batch of 3 (`L1-L3`) and check that they come out half-cut on one strip.

## Troubleshooting

| Labels page says | Fix |
|---|---|
| *not configured* | `INVENTARIUS_PRINTER` is empty. |
| *permission denied* | The container is missing `group_add: ["7"]`, or the device has another group (`ls -l /dev/usb/lp0`). |
| *no such file* | Printer off or unplugged, or `usblp` not loaded. |
| *did not answer* | Turn the printer off and on. Make sure nothing else (CUPS, P-touch Editor) is using it. |
| *no tape / cover open / wrong tape loaded* | As it says. Then press *Retry* on the failed jobs. |
| *printer has 18 mm tape loaded; labels need 12 or 24 mm* | Load 12 or 24 mm tape, then press *Retry*. |
