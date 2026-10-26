# Device checklist

Automated tests cover WebKit, Firefox and Chromium engines on a desktop.
The checks below need a real phone, tablet and speaker, and are run by a person before a release.
Record the device, OS version, browser and the result of each line in the release notes.

## Before you start

- Serve the release image through HTTPS on the home network.
- Open the app once, tap Test sound, and confirm the beep plays.
- Check Settings → General shows "Connected" and the server version.

## Audio

- [ ] Beeps and the chosen voice play at the first boundary after Start, with the device's silent switch on and off.
- [ ] Voices keep playing while the screen is locked for a few seconds and after it is unlocked.
- [ ] A phone call or notification sound during a workout does not stop the clock, and cues resume afterwards.
- [ ] The two-metre test: the next movement is readable and the countdown is audible from the far side of the room with music playing at a normal level.

## Screen and layout

- [ ] The player fills the screen in portrait and landscape without clipping, at the device's default text size and one size larger.
- [ ] Screen wake lock keeps the display on for a whole 20-minute session ("Screen stays awake" in the player).
- [ ] Added to the home screen (iOS and Android): the app opens, plays audio after one tap, and keeps its data.

## Interruptions and recovery

- [ ] Switch to another app mid-session and come back: the player is paused with "Paused · app was hidden" and resumes on Resume.
- [ ] Kill the browser mid-session and reopen the player: the recovery prompt shows the saved age, Resume restores the lane, round and clock.
- [ ] Open the same session in a second tab or device: the second one offers Take over, the first one stops controlling.
- [ ] Turn off Wi-Fi mid-session, finish, turn it on: the session appears in History exactly once and the "changes waiting" pill clears.
- [ ] Put the phone in a pocket with the screen locked for two minutes: on unlock the session is paused or still running, never jumped ahead.

## Household

- [ ] Save a workout on one device and see it on another within a reload.
- [ ] Download a backup from Settings → General on the phone and confirm the file arrives in the device's files.
- [ ] Clear the browser's site data on one device: the library returns from the server after a reload, and nothing synchronised is lost.
