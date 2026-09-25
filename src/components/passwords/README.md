# `components/passwords`

The Passwords tab ([Task 134](../../../../tasks.md#task-134)). Everything it decides is in
[`lib/credentials`](../../lib/credentials/README.md) and `lib/app/passwords.ts`.

| File | Role |
| --- | --- |
| `PasswordsScreen.tsx` | The list, the delete confirmation, and the write calls |
| `PasswordFormModal.tsx` | Adding or editing one login: site, username, password, note, the other addresses it works on, whether the extension offers it on the whole site, and *Previous passwords* |
| `DeletedPasswords.tsx` | *Recently deleted*, and restoring from it |

**An edit writes a new revision, so "Save" appends rather than replaces.** The form says so in its
subtitle, and its button reads *Save revision*. The form keeps the credential's decoded payload as
`base` and spreads it under the edited fields, so a field this client does not show — one another
client added — survives the edit.

**The form owns its draft; the screen owns the write.** `PasswordFormModal` holds what is typed and
reads the history for *Previous passwords*; it hands the encoded payload to `onSave`, and the screen
calls `writeCredential` and closes the form only when the write succeeded. A failed save leaves the
dialog open with everything typed still in it. The screen keys the form by the credential it edits,
so opening a different row always starts from that row's values.

**A delete is confirmed, and restorable.** The confirmation is a
[`ConfirmDeleteModal`](../modal/README.md) that says the login disappears from every device,
including the browser extensions, and can be brought back from *Recently deleted* until it is
pruned. *Recently deleted* reads nothing until *Show* is pressed, because it walks every revision of
every credential.

The list is an [`ItemList`](../item-list/README.md), and the passwords mask with the same top-bar
toggle as the Vault's values (`VaultReveal`).
