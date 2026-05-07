import { describe, it, expect, beforeEach, vi } from 'vitest'

const showMessageBox = vi.fn()

vi.mock('electron', () => ({
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
}))

vi.mock('../window-state.js', () => ({
  getWindow: () => null,
}))

const { showWarning, showModal } = await import('../notifications/modal.js')

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
