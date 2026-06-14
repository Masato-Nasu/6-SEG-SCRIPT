# 6SEG SCRIPT

**6SEG SCRIPT** is a visual writing system based on six segment glyphs.

It started from the 2017 concept **6 SEGMENT LED WATCH** and expands the same six-segment idea from numbers into letters, symbols, readable PNG output, and encrypted PNG output.

## Modes

### SCRIPT MODE

A non-encrypted mode.

- Converts text into readable 6SEG glyphs
- Supports A-Z, 0-9, space, and symbols such as `@`
- Saves as black-and-white PNG
- Reads back the glyphs from the PNG image itself
- No hidden metadata is embedded

This mode is not encryption. It is an unused display standard: unfamiliar at first, but readable once learned.

### LOCK MODE

A strong encrypted mode.

- Encrypts text with **AES-GCM 256bit**
- Derives the key from the password with **PBKDF2-SHA-256**
- Uses random salt and IV for every PNG
- Encodes the encrypted binary data as visible 6SEG glyphs
- Saves as black-and-white PNG
- Reads the visible glyphs back from the PNG and decrypts with the password

The PNG does not contain hidden metadata. The encrypted data is drawn as the 6SEG glyph sequence itself.

> Security note: the encryption method is strong, but security still depends heavily on the password. Use a long, unique password.

## Features

- Text to 6SEG glyphs
- Normal readable 6SEG PNG output
- PNG-to-text reading from the visible glyphs
- Strong encrypted LOCK PNG output
- LOCK PNG reading and password-based decryption
- 6SEG substitution table
- Table PNG export
- Static web app / PWA

## How to use

Open `index.html` or deploy the folder to Cloudflare Pages.

For local testing, SCRIPT MODE works directly in a browser.
LOCK MODE uses the Web Crypto API and is best used on HTTPS, such as Cloudflare Pages.

## Concept

This is not just a font.

It is an unused display standard:
a way of writing letters, numbers, symbols, and encrypted data with the same six-segment structure.

**SCRIPT MODE** is readable if you learn the system.  
**LOCK MODE** is unreadable without the password.

Both use the same visible six-segment surface.

## Version

v0.2.0

## Author

MASATO / MASATO LAB
