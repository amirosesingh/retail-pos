# Stable release revisions

The requested display label `1.4.77 (1)` uses the immutable package identity
`1.4.77+revision.1`. The base version remains 1.4.77. Tags, artifact paths and
signed OTA metadata retain the machine identity; the UI formats its label.
Never replace the original v1.4.77 tag or its immutable artifacts.

The publisher compares only explicit `+revision.N` metadata numerically when
base versions match. Other build metadata retains normal SemVer precedence.
Later base versions still take precedence over any earlier revision.

## First-revision installation limitation

Previously installed clients ignore SemVer build metadata. Publishing a feed
cannot change that installed comparison code. Existing Windows clients and
iPhones on 1.4.77 may therefore need the new installer/IPA manually. The new
iOS and shared manifest comparator recognizes revisions and prevents reverting
to the base release. Electron's native updater still uses standard SemVer;
same-base revisions require manual installation on Windows. Normal later
three-part versions continue through its existing updater.

Android receives an increasing native versionCode from the existing pipeline.
The native versionName and app UI display `1.4.77 (1)`. The original release
and the revision use different download paths. No business data is renumbered
or deleted by this release identity change.
