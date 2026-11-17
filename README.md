# Q-OS (Q-CUBIC Remote)

Your home PC, shaped like a phone. Install the PC app once and the Q-OS phone app once, then use every app on your PC from your phone, from any network. Free.

The phone shows a Windows Mobile style interface built only from your PC's own data: its wallpaper, its user, its apps (the same list as the Windows Start menu), its battery, Wi-Fi, storage and its Windows Settings pages. Tap an app and it opens on the PC, reshaped to the phone's portrait size, and appears on the phone full-screen. Nothing runs on the phone itself.

Copyright (c) 2026 Pruthvi. All rights reserved.

## Download

Go to **Releases** (right side of this page) and download:

- **QCubicRemote-windows.zip** - for your PC. Unzip, then run `Q-CUBIC Remote.exe`.
- **q-cubic-remote-android.apk** - for your phone.

Or use the phone app in Chrome: https://qcubic24-prog.github.io/q-cubic-remote/

## How it works

- The PC shows a permanent 9-digit PC ID and a one-time 6-digit pairing code.
- The phone pairs once, then connects with one tap from Wi-Fi or mobile data.
- The screen goes directly from the PC to the phone (WebRTC, encrypted).
- The two find each other through a free public message relay; every message is sealed with AES-256-GCM first.

## On the phone

- Lock screen: your PC's wallpaper, the PC's time, your Windows user name and PC status. Swipe up.
- Start: live tiles for this PC, date, storage, Wi-Fi, battery, settings, recent apps, the full PC desktop, and your PC apps. Hold a tile to unpin it.
- All apps: every app in your PC's Start menu, with search. Hold an app to pin it to Start.
- Quick settings: tap the top bar or pull down. PC volume, PC brightness (laptops), Wi-Fi, Bluetooth and more open the real Windows Settings pages.
- Settings: the Windows Settings sections; each opens the real page on the PC, in phone shape.
- In an app: tap to click, slide up or down to scroll, slide sideways to drag, hold for right click, pinch to zoom, keyboard button to type.
- Back button: back to Start (the app keeps running on the PC). Hold it for recent apps (windows open on the PC).

## Folders

- `app/` - Windows PC app (Electron); `app/qos.js` gives the phone the PC's data and shapes app windows
- `phone/` - phone app (web app, also packaged as the Android APK); `phone/qos.js` and `qos.css` are the Q-OS interface
- `.github/workflows/build.yml` - builds the Windows zip, the APK and the phone web app on every change
