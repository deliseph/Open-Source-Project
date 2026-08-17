# Demo GIF for the README.
#
# Requires vhs: https://github.com/charmbracelet/vhs
#   brew install vhs   (or: go install github.com/charmbracelet/vhs@latest)
#
# Run from the repo root, with a real export at ./instagram.zip:
#   vhs docs/launch/demo.tape
#
# Then put docs/launch/demo.gif at the top of the README, directly under the
# tagline. Keep it under ~20 seconds — nobody watches longer, and GitHub is
# slow to load anything over about 5MB.
#
# IMPORTANT: record with a throwaway export, or blur the output. A demo GIF of
# your own archive puts your private messages in the README permanently.

Output docs/launch/demo.gif

Set Shell zsh
Set FontSize 18
Set Width 1200
Set Height 640
Set Padding 24
Set Theme "Catppuccin Latte"
Set TypingSpeed 60ms

# Beat 1 — the pile of ZIPs nobody can read.
Type "ls ~/Downloads/*.zip"
Enter
Sleep 2s

# Beat 2 — one command.
Type "npx archivore build instagram.zip tiktok.zip -o ~/my-archive"
Enter
Sleep 8s

# Beat 3 — the payoff. Let the warnings sit on screen; the Snapchat and TikTok
# expiring-link notices are the most-quoted part of the whole tool.
Sleep 3s

# Beat 4 — open the archive. Screen-record the browser separately and splice it
# in if you want the page in the same GIF; vhs only captures the terminal.
Type "open ~/my-archive/index.html"
Enter
Sleep 3s
