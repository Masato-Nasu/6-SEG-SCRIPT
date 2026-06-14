# 6SEG SCRIPT

**6SEG SCRIPT** is a web app based on an unused display standard made from only six segments.

It began as an extension of **6 SEG CLOCK** / **6 SEGMENT LED WATCH** and expands the six-segment idea from numbers into letters, symbols, readable PNG output, and encrypted PNG output.

This is not just a font.
It is a writing system built from six segments.

---

## Screenshots

### 1. SCRIPT MODE

![screenshot1](docs/screenshot1.png)

SCRIPT MODE converts ordinary text into readable 6SEG glyphs.
It can also read the visible glyphs back from a PNG image.

### 2. LOCK MODE

![screenshot2](docs/screenshot2.png)

LOCK MODE encrypts the input text and renders the encrypted result as visible 6SEG glyphs.
The result can be saved as a PNG and later restored with the correct password.

### 3. UNLOCK MODE / TABLE

![screenshot3](docs/screenshot3.png)

UNLOCK MODE reads a LOCK PNG and decrypts it.
The substitution table is also shown in the app so the readable 6SEG script can be learned and manually read.

---

## Concept

A normal segment display usually uses seven segments.
**6SEG SCRIPT** removes the vertical segments and uses only:

- top horizontal
- upper-left diagonal
- upper-right diagonal
- lower-left diagonal
- lower-right diagonal
- bottom horizontal

Each glyph is made from the ON/OFF combination of these six strokes.
That means the system has **2^6 = 64** possible patterns.

These 64 visible glyphs are assigned to:

- A-Z
- 0-9
- space
- punctuation and symbols such as `@`

As a result, the app becomes a small alternative writing system: readable once learned, but unfamiliar at first glance.

---

## Main Modes

## 1. SCRIPT MODE

SCRIPT MODE is the readable mode.

- Converts text into visible 6SEG glyphs
- Supports uppercase letters, numbers, spaces, and symbols
- Saves as black-and-white PNG
- Reads the glyphs back from the PNG image itself
- No hidden metadata is embedded in the PNG

In this mode, the output is not intended as strong cryptography.
It is a readable but unfamiliar script.

## 2. LOCK MODE

LOCK MODE is the strongly encrypted mode.

- Encrypts text before rendering
- Saves the encrypted result as visible 6SEG glyphs
- Reads the glyphs back from the PNG image itself
- Requires the correct password to restore the original text

Current encryption stack:

- **AES-GCM 256bit**
- **PBKDF2-SHA-256**

Important: security depends not only on the algorithm, but also on the strength of the password.
A long, unique password is recommended.

## 3. UNLOCK MODE

UNLOCK MODE reads a LOCK PNG and decrypts it with the password.

This means the app has two different relationships to readability:

- **SCRIPT MODE**: readable if you learn the system
- **LOCK MODE**: unreadable without the password

Both share the same six-segment surface.

---

## PNG Philosophy

A key point of **6SEG SCRIPT** is that it does **not** hide the original text in PNG metadata.

The app reads the **drawn glyphs themselves**.
In other words:

> the visible image is the data.

This is why the app feels closer to an unused display standard or a fictional writing system than to a normal export utility.

---

## X / Social Posting

The app also supports smaller PNG output suitable for posting to X while keeping the glyphs readable by the app.

- normal PNG: larger, easier to inspect
- X-readable PNG: smaller, post-friendly, still decodable by the app

---

## Features

- Text to 6SEG conversion
- Visible PNG output
- PNG-to-text reading from visible glyphs
- LOCK PNG generation
- LOCK PNG decryption
- Substitution table display
- Table PNG export
- X-readable PNG export
- Static web app / PWA

---

## How to use

1. Enter text in **SCRIPT MODE** and render it as 6SEG glyphs.
2. Save the output as PNG if needed.
3. Load the PNG again to restore the text from the visible glyphs.
4. For secure use, switch to **LOCK MODE**.
5. Enter text and a password.
6. Save the encrypted 6SEG PNG.
7. In **UNLOCK MODE**, load the PNG and enter the password to decrypt it.

---

## Why it is interesting

**6SEG SCRIPT** sits between typography, cryptography, conceptual design, and fictional standards.

It is:

- not just a font
- not just an image generator
- not just an encryption demo

It is a script system that might have existed in a different technical culture.

If **6 SEG CLOCK** is a clock from an unused display standard,
then **6SEG SCRIPT** is the writing system that belongs to the same world.

---

## Version

**v0.2.2**

---

## Author

**MASATO / MASATO LAB**
