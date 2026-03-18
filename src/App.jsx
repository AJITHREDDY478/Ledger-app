import { useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'ledger-entries-v3'

const defaultEntries = []

function formatDateTime(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  const day = String(parsed.getDate()).padStart(2, '0')
  const month = parsed.toLocaleString('en-US', { month: 'short' })
  const year = parsed.getFullYear()

  const hour12 = parsed.getHours() % 12 || 12
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  const meridiem = parsed.getHours() >= 12 ? 'PM' : 'AM'

  return `${day}-${month}-${year} ${hour12}:${minutes} ${meridiem}`
}

function App() {
  const [entries, setEntries] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaultEntries
    try {
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) ? parsed : defaultEntries
    } catch {
      return defaultEntries
    }
  })

  const [form, setForm] = useState({
    name: '',
    work: '',
    date: '',
    credit: '',
    debit: '',
  })
  const [searchText, setSearchText] = useState('')
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, [entries])

  const rowsWithBalance = useMemo(() => {
    let runningBalance = 0
    return entries.map((entry, index) => {
      const credit = Number(entry.credit) || 0
      const debit = Number(entry.debit) || 0
      runningBalance += credit - debit
      return {
        ...entry,
        slNo: index + 1,
        date: entry.date || '',
        credit,
        debit,
        balance: runningBalance,
      }
    })
  }, [entries])

  const totals = useMemo(() => {
    return rowsWithBalance.reduce(
      (acc, row) => {
        acc.credit += row.credit
        acc.debit += row.debit
        acc.balance = row.balance
        return acc
      },
      { credit: 0, debit: 0, balance: 0 },
    )
  }, [rowsWithBalance])

  const filteredRows = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return rowsWithBalance

    return rowsWithBalance.filter((row) => {
      return [
        row.slNo,
        row.name,
        row.work,
        row.date,
        row.credit,
        row.debit,
        row.balance,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [rowsWithBalance, searchText])

  const filteredTotals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.credit += row.credit
        acc.debit += row.debit
        acc.balance = row.balance
        return acc
      },
      { credit: 0, debit: 0, balance: 0 },
    )
  }, [filteredRows])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage))
  const pageStartIndex = (currentPage - 1) * rowsPerPage
  const paginatedRows = filteredRows.slice(pageStartIndex, pageStartIndex + rowsPerPage)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchText, rowsPerPage])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  function handleChange(event) {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function handleAddEntry(event) {
    event.preventDefault()

    const credit = Number(form.credit) || 0
    const debit = Number(form.debit) || 0

    if (!form.name.trim() || !form.work.trim()) {
      return
    }

    const dateValue = form.date
      ? new Date(`${form.date}T00:00:00`).toISOString()
      : new Date().toISOString()

    const nextEntry = {
      id: Date.now(),
      name: form.name.trim(),
      work: form.work.trim(),
      date: dateValue,
      credit,
      debit,
    }

    setEntries((prev) => [...prev, nextEntry])
    setForm({ name: '', work: '', date: '', credit: '', debit: '' })
    if (!searchText.trim()) {
      setCurrentPage(Math.ceil((entries.length + 1) / rowsPerPage))
    }
  }

  return (
    <main className="app-shell">
      <section className="card">
        <header className="app-header">
          <img src="/logo.svg" alt="Ledger logo" className="app-logo" />
          <div>
            <h1>Ledger</h1>
            <p className="app-tagline">Track Credits &amp; Debits</p>
          </div>
        </header>

        <form className="entry-form" onSubmit={handleAddEntry}>
          <input
            name="name"
            placeholder="Name"
            value={form.name}
            onChange={handleChange}
            required
          />
          <input
            name="work"
            placeholder="Work"
            value={form.work}
            onChange={handleChange}
            required
          />
          <input
            name="credit"
            type="number"
            min="0"
            placeholder="Credit"
            value={form.credit}
            onChange={handleChange}
          />
          <input
            name="debit"
            type="number"
            min="0"
            placeholder="Debit"
            value={form.debit}
            onChange={handleChange}
          />
          <input
            name="date"
            type="date"
            value={form.date}
            onChange={handleChange}
          />
          <button type="submit" style={{ gridColumn: 'span 2' }}>Add Row</button>
        </form>

        <input
          aria-label="Search ledger rows"
          className="search-input"
          type="search"
          placeholder="Search by name, work, date, amount..."
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sl No</th>
                <th>Name</th>
                <th>Work</th>
                <th>Date</th>
                <th>Credit</th>
                <th>Debit</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Sl No">{row.slNo}</td>
                  <td data-label="Name">{row.name}</td>
                  <td data-label="Work">{row.work}</td>
                  <td data-label="Date">{formatDateTime(row.date)}</td>
                  <td data-label="Credit">{row.credit}</td>
                  <td data-label="Debit">{row.debit}</td>
                  <td data-label="Balance">{row.balance}</td>
                </tr>
              ))}
              {paginatedRows.length === 0 && (
                <tr>
                  <td colSpan="7">No matching rows found.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan="4">Total</th>
                <th>{searchText ? filteredTotals.credit : totals.credit}</th>
                <th>{searchText ? filteredTotals.debit : totals.debit}</th>
                <th>{searchText ? filteredTotals.balance : totals.balance}</th>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="pagination-toolbar">
          <label htmlFor="rows-per-page">per page</label>
          <select
            id="rows-per-page"
            value={rowsPerPage}
            onChange={(event) => setRowsPerPage(Number(event.target.value))}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
          >
            Next
          </button>
        </div>
      </section>
    </main>
  )
}

export default App
