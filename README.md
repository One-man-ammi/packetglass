# Packetglass

*A workbench for reverse-engineering BLE devices - the view Wireshark never gave you.*

> **Status: planning / v1 spec.** Built while reverse-engineering a cheap fitness band ([h59-ultra-reverse-engineering](https://github.com/One-man-ammi/h59-ultra-reverse-engineering)), because Wireshark showed raw bytes but nothing about the device behind them.

---

## Why

Wireshark is a network tool. When you open a Bluetooth HCI capture in it, it tells you
everything about the *Bluetooth* layer - handles, ATT opcodes, MTU - and nothing about
the *device* you are actually reverse-engineering. Is `b1 07ea 0b 18 0b 00 5a` a battery
level? A timestamp? You find out by squinting at hex, keeping notes in a text file, and
remembering what you tapped in the stock app and when.

Packetglass is the missing view on top: load the same capture, and work the way a
device reverse-engineer actually works - one action at a time, one packet type at a time.

## What it does (v1)

### 1. Import

- Parse `btsnoop_hci.log` (Android HCI snoop capture) directly in the browser - no upload, no backend
- Also import CSV exports (Wireshark "Packet List"/"Bytes" CSVs) as a fallback path
- Filter to the interesting conversation automatically: pick your device, see only its writes and notifications, in order, with the ATT plumbing hidden

### 2. Read packets like a human

Each payload shown side by side as:

- **Hex** - the raw truth
- **ASCII** - because vendor strings leak meaning (`FVP60`, serial numbers)
- **Numbers** - every plausible decode of every field: uint8 / uint16 / uint32, little-endian and big-endian, so `0x07ea` and `0x5a` are readable at a glance instead of mental math

### 3. Diff by event

The killer feature. You mark the moment you did something on the device:

> 10:41:26 - tapped "start heart rate" in the stock app

Packetglass then highlights what appeared/changed after that mark - new packet types,
changed fields, repeating patterns. Your manual method ("one action per capture,
watch what changes"), automated.

### 4. Annotate and remember

- Label any packet or field: "this byte is battery", "0x44 = get model"
- Sessions save with their annotations; findings export as a Markdown table - paste straight into a README

## The AI hook (deliberately open, not in v1)

Once sessions carry human annotations, an optional panel can suggest candidate
meanings for unannotated fields - "bytes 1-4 look like a big-endian date; 0x5a=90
fits a battery percentage" - checked against every packet in the session before it
dares to speak.

The tool is fully useful **without** AI. AI is a layer on annotated data, never a
replacement for it.

## Stack

- TypeScript + React (Vite)
- Runs 100% in the browser, local-first: captures never leave your machine
- btsnoop parsing per the [btstack btsnoop documentation](https://github.com/bluekitchen/btstack/blob/master/doc/md/btstack.md) (format is a documented classic)
- No backend, no account, no cloud

## Roadmap

- [ ] v0.1 - btsnoop import, device filter, hex/ASCII/numbers view
- [ ] v0.2 - event marks + diff-by-event highlighting
- [ ] v0.3 - annotations, session save/load, Markdown export
- [ ] v0.4 - live mode: follow a capture session in real time from a companion app
- [ ] v0.5? - optional AI decode suggestions on annotated sessions

## Related

- [h59-ultra-reverse-engineering](https://github.com/One-man-ammi/h59-ultra-reverse-engineering)) - the project that motivated this tool; Packetglass is used (and dogfooded) to decode the band

## Disclaimer

Research tool for interoperability with devices you own. Not affiliated with any vendor.

---

*Load a capture. See your device.*
