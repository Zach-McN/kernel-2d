import { useState, type ReactElement } from 'react'

import { defaultPrefab, type Prefab } from '../../runtime/formats/prefab-schema'
import { defaultScene, type Scene } from '../../runtime/formats/scene-schema'
import { messageOf } from '../../runtime/message-of'
import type { Room } from '../shell/floating'
import { createDocumentOnDisk } from '../store/document-disk'
import { mintId } from '../store/ids'

/**
 * Making a level, or a prefab: a small card with a name, two buttons, and the
 * whole path it is about to create.
 *
 * **It is a menu now rather than a row under the browser.** The Assets panel
 * shows the project folder, and a permanent make-a-file row at the bottom of it
 * was a control that is used once an afternoon holding room that the folder is
 * looked at all day. So it is behind the `+` in the bar, and behind a
 * right-click on the empty part of the browser — the two places a hand goes to
 * make something in a file browser (`AssetsPanel.tsx` holds the one anchor both
 * doors open).
 *
 * The whole path is on screen before anything is committed, because this is the
 * one control in the editor that puts a file in somebody's project folder and
 * "where did it go?" is not a question a human should have to answer by
 * searching. Refusals are the service's own sentences, shown as they arrive —
 * it knows things this panel does not, like whether the name is already taken.
 *
 * One name field and two buttons rather than two menu items, because the *path*
 * is the same question either way and only the contents differ. Which button was
 * pressed decides what goes inside; nothing about the file's name or folder says
 * which kind it is, and nothing later reads it that way (`editor-ui` U11).
 *
 * **Typing is not kept when it closes.** The card is unmounted, so a name half
 * typed into a menu that was dismissed is gone — which is what a menu means, and
 * the alternative is a field that remembers something the human abandoned.
 */
export function NewDocument({
  folder,
  onCreated,
}: {
  /** Where the file goes. Decided by the panel from what is selected. */
  folder: string
  /** It exists: reveal it, select it, and close the menu that made it. */
  onCreated: (path: string) => void
}): ReactElement {
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const typed = name.trim()
  // `.json` is added rather than demanded, and left alone when it is already
  // there, so nobody ends up with `level-03.json.json`.
  const file = typed === '' ? '' : typed.endsWith('.json') ? typed : `${typed}.json`
  const path = file === '' ? '' : folder === '' ? file : `${folder}/${file}`

  const create = (document: Scene | Prefab): void => {
    if (path === '' || busy) return

    setBusy(true)
    setProblem(null)

    void createDocumentOnDisk(path, document)
      .then(() => {
        setName('')
        // Selecting it is what opens it: a file becomes the open scene, or the
        // prefab the Inspector is showing, because of the format inside it,
        // which the shell reads when it is selected.
        onCreated(path)
      })
      .catch((error: unknown) => {
        setProblem(messageOf(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <form
      className="assets__new"
      data-testid="new-document"
      onSubmit={(event) => {
        event.preventDefault()
        create(defaultScene())
      }}
    >
      <input
        type="text"
        className="control control--text"
        data-testid="new-document-name"
        placeholder="New level or prefab"
        aria-label="Name for a new level or prefab"
        // The cursor is in the field the moment the menu opens: there is one
        // thing to do here and it starts with typing a name.
        autoFocus
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setProblem(null)
        }}
      />

      <div className="assets__new-row">
        <button
          type="submit"
          className="control control--action"
          data-testid="new-scene-create"
          disabled={path === '' || busy}
        >
          New scene
        </button>
        <button
          type="button"
          className="control control--action"
          data-testid="new-prefab-create"
          disabled={path === '' || busy}
          // The prefab is named after the file it is going into, which is the
          // name the human just typed — there is nothing else it could sensibly
          // be, and it is editable the moment it opens.
          onClick={() => create(defaultPrefab(mintId(), withoutJsonExtension(file)))}
        >
          New prefab
        </button>
      </div>

      <p className="assets__new-path" data-testid="new-document-path">
        {path === '' ? (
          <>Will go in <strong>{folder === '' ? 'the top of the project' : folder}</strong></>
        ) : (
          <>Will make <strong>{path}</strong></>
        )}
      </p>

      {problem !== null && (
        <p className="assets__new-problem" data-testid="new-document-problem">
          {problem}
        </p>
      )}
    </form>
  )
}

/**
 * How much room the card needs, so a right-click near the bottom of the panel
 * opens it upward of the edge rather than half off it.
 *
 * Measured from what it holds — a field, a row of two buttons, and a line of
 * path — with the margin from the edge already in it (`../shell/floating.ts`).
 */
export const NEW_DOCUMENT_ROOM: Room = { width: 258, height: 103 }

/** A file name without its `.json`, for naming what goes inside it. */
function withoutJsonExtension(file: string): string {
  return file.replace(/\.json$/i, '')
}
