import { describe, it, expect, beforeEach, vi } from 'vitest'

const showMessageBox = vi.fn()

vi.mock('electron', () => ({
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
}))

vi.mock('../window-state.js', () => ({
  getWindow: () => null,
}))

const { showWarning, showModal, MODAL_QUEUE_MAX, __resetModalQueueForTests } = await import('../notifications/modal.js')

describe('notifications/modal — showWarning', () => {
  beforeEach(() => {
    showMessageBox.mockReset()
  })

  it('passes warning options to dialog.showMessageBox', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    await showWarning('plug-1', 'Hi', 'detail line')
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    const opts = showMessageBox.mock.calls[0]![0]
    expect(opts).toMatchObject({
      type: 'warning',
      title: 'plug-1',
      message: 'Hi',
      detail: 'detail line',
      buttons: ['OK'],
    })
  })
})

describe('notifications/modal — showModal', () => {
  beforeEach(() => {
    showMessageBox.mockReset()
  })

  it('returns the id of the button at the response index', async () => {
    showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })
    const result = await showModal('plug-1', {
      message: 'Pick',
      buttons: [
        { id: 'go', label: 'Go' },
        { id: 'no', label: 'No' },
      ],
    })
    expect(result).toBe('no')
  })

  it('defaults to a single OK button when buttons is omitted', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const result = await showModal('plug-1', { message: 'Done' })
    expect(result).toBe('ok')
    const opts = showMessageBox.mock.calls[0]![0]
    expect(opts.buttons).toEqual(['OK'])
  })

  it('defaults to a single OK button when buttons is empty array', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const result = await showModal('plug-1', { message: 'Done', buttons: [] })
    expect(result).toBe('ok')
  })

  it('sets defaultId from the button marked default', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    await showModal('plug-1', {
      message: 'Pick',
      buttons: [
        { id: 'go', label: 'Go' },
        { id: 'no', label: 'No', default: true },
      ],
    })
    expect(showMessageBox.mock.calls[0]![0].defaultId).toBe(1)
  })

  it('sets cancelId from the button marked cancel', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    await showModal('plug-1', {
      message: 'Pick',
      buttons: [
        { id: 'go', label: 'Go' },
        { id: 'no', label: 'No', cancel: true },
      ],
    })
    expect(showMessageBox.mock.calls[0]![0].cancelId).toBe(1)
  })

  it('serializes concurrent calls — second dialog waits for first', async () => {
    let firstResolve!: (v: { response: number; checkboxChecked: boolean }) => void
    let secondResolve!: (v: { response: number; checkboxChecked: boolean }) => void
    showMessageBox
      .mockImplementationOnce(() => new Promise((r) => { firstResolve = r }))
      .mockImplementationOnce(() => new Promise((r) => { secondResolve = r }))

    const p1 = showModal('plug-1', { message: 'first' })
    const p2 = showModal('plug-2', { message: 'second' })

    await Promise.resolve()
    await Promise.resolve()
    expect(showMessageBox).toHaveBeenCalledTimes(1)

    firstResolve({ response: 0, checkboxChecked: false })
    await p1
    await Promise.resolve()
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    secondResolve({ response: 0, checkboxChecked: false })
    await p2
  })
})

describe('notifications/modal — queue cap', () => {
  beforeEach(() => {
    showMessageBox.mockReset()
    __resetModalQueueForTests()
  })

  it('drops new showModal calls past MODAL_QUEUE_MAX, resolving with cancel id', async () => {
    // Single shared mock impl so each invocation pushes its resolver. The
    // chain serializes — only the first dialog actually opens until #1
    // resolves, so resolvers[] grows one at a time as we drain.
    const resolvers: Array<(v: { response: number; checkboxChecked: boolean }) => void> = []
    showMessageBox.mockImplementation(
      () => new Promise<{ response: number; checkboxChecked: boolean }>((r) => { resolvers.push(r) }),
    )

    const pending = Array.from({ length: MODAL_QUEUE_MAX }, (_, i) =>
      showModal('plug', { message: `m${i}` }),
    )
    // Let microtasks settle so the chain advances and dialog #1 opens.
    await Promise.resolve()
    await Promise.resolve()
    expect(resolvers).toHaveLength(1) // only #1 is showing; depth is at MAX

    const dropped = await showModal('plug', {
      message: 'overflow',
      buttons: [
        { id: 'go', label: 'Go' },
        { id: 'no', label: 'No', cancel: true },
      ],
    })
    expect(dropped).toBe('no')
    expect(resolvers).toHaveLength(1) // dropped — no new showBox invoked

    // Drain by resolving sequentially as each next dialog opens.
    for (let i = 0; i < MODAL_QUEUE_MAX; i++) {
      let ticks = 0
      while (resolvers.length <= i && ticks++ < 100) await Promise.resolve()
      resolvers[i]!({ response: 0, checkboxChecked: false })
    }
    await Promise.all(pending)
  })

  it('drops showWarning calls past the cap, resolving to undefined', async () => {
    const resolvers: Array<(v: { response: number; checkboxChecked: boolean }) => void> = []
    showMessageBox.mockImplementation(
      () => new Promise<{ response: number; checkboxChecked: boolean }>((r) => { resolvers.push(r) }),
    )

    const pending = Array.from({ length: MODAL_QUEUE_MAX }, (_, i) =>
      showWarning('plug', `w${i}`),
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(resolvers).toHaveLength(1)

    await expect(showWarning('plug', 'overflow')).resolves.toBeUndefined()
    expect(resolvers).toHaveLength(1)

    for (let i = 0; i < MODAL_QUEUE_MAX; i++) {
      let ticks = 0
      while (resolvers.length <= i && ticks++ < 100) await Promise.resolve()
      resolvers[i]!({ response: 0, checkboxChecked: false })
    }
    await Promise.all(pending)
  })

  it('reopens a slot once a dialog drains — call (MAX+1) succeeds after first resolves', async () => {
    const resolvers: Array<(v: { response: number; checkboxChecked: boolean }) => void> = []
    showMessageBox.mockImplementation(
      () => new Promise<{ response: number; checkboxChecked: boolean }>((r) => { resolvers.push(r) }),
    )

    const pending = Array.from({ length: MODAL_QUEUE_MAX }, (_, i) =>
      showModal('plug', { message: `m${i}` }),
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(resolvers).toHaveLength(1)

    // Resolve dialog #1 → finally() decrements depth → slot reopens.
    resolvers[0]!({ response: 0, checkboxChecked: false })
    await pending[0]

    // A new call should be admitted (it joins the back of the queue, so it
    // won't open until the existing in-flight ones drain — but it should
    // NOT be dropped).
    const after = showModal('plug', { message: 'after' })

    // Drain in order: #2 .. #MAX, then `after`.
    for (let i = 1; i < MODAL_QUEUE_MAX + 1; i++) {
      let ticks = 0
      while (resolvers.length <= i && ticks++ < 100) await Promise.resolve()
      resolvers[i]!({ response: 0, checkboxChecked: false })
    }
    await Promise.all(pending.slice(1))
    expect(await after).toBe('ok')
  })
})
