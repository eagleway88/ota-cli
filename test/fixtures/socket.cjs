class FakeSocket {
  connected = false
  handlers = new Map()
  calls = []
  nextResponse
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event).add(fn)
  }
  off(event, fn) {
    this.handlers.get(event)?.delete(fn)
  }
  dispatch(event, value) {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(value)
  }
  connect() {
    if (!this.connected) {
      this.connected = true
      this.dispatch('connect')
    }
  }
  disconnect() {
    if (this.connected) {
      this.connected = false
      this.dispatch('disconnect', 'transport close')
    }
  }
  timeout() {
    return {
      emitWithAck: async (event, payload) => {
        this.calls.push({ event, payload })
        if (this.nextResponse) {
          const response = this.nextResponse
          this.nextResponse = undefined
          return response
        }
        if (event === 'app:subscribe' || event === 'app:unsubscribe')
          return { appName: payload.appName }
        if (event.endsWith(':ack')) return { ...payload, acked: true, clientId: 'socket-1' }
        return event.startsWith('userId:')
          ? { uid: payload.userId }
          : { uniqueId: payload.uniqueId }
      }
    }
  }
}
module.exports = { FakeSocket }
