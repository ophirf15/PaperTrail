export function matchesLoose(fields: string[], query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const blob = fields.join('\n').toLowerCase()
  if (blob.includes(needle)) return true
  if (/^[0-9x\-\s]+$/i.test(needle) || needle.length < 4) return false
  const words = needle.split(/\s+/).filter((word) => word.length > 0)
  const tokens = blob.split(/[^a-z0-9]+/i).filter((word) => word.length > 1)
  return words.every((word) => {
    if (word.length < 4) return blob.includes(word)
    return tokens.some((token) => withinEdits(word, token))
  })
}

function withinEdits(word: string, token: string): boolean {
  if (token.includes(word) || word.includes(token)) return true
  const limit = word.length <= 5 ? 1 : 2
  if (Math.abs(word.length - token.length) > limit) return false
  return editDistance(word, token) <= limit
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1
  const cols = right.length + 1
  const grid: number[] = Array.from({ length: cols }, (_, index) => index)
  for (let row = 1; row < rows; row += 1) {
    let previous = grid[0] ?? 0
    grid[0] = row
    for (let col = 1; col < cols; col += 1) {
      const current = grid[col] ?? 0
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      grid[col] = Math.min((grid[col - 1] ?? 0) + 1, current + 1, previous + cost)
      previous = current
    }
  }
  return grid[cols - 1] ?? 0
}
