export function createContentFromBody (body, contentType) {
  if (Buffer.isBuffer(body)) {
    return body
  }

  switch (contentType) {
    case 'application/json':
      if (typeof body === 'string') {
        return Buffer.from(body)
      } else {
        return Buffer.from(JSON.stringify(body))
      }
    case 'text/plain':
      return Buffer.from(body)
    default:
      throw new Error('unable to create content from body')
  }
}
