import { useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'ledger-entries-v3'
const SEED_KEY = 'ledger-seed-version'
const SEED_VERSION = 3

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

const defaultEntries = [
  { id: 1,  name: 'Ajith Kumar',   work: 'Printing',         date: '2026-01-03T09:15:00.000Z', credit: 5000,  debit: 0    },
  { id: 2,  name: 'Ravi Shankar',  work: 'Logo Design',      date: '2026-01-07T10:30:00.000Z', credit: 0,     debit: 1200 },
  { id: 3,  name: 'Meena Devi',    work: 'Web Development',  date: '2026-01-12T11:00:00.000Z', credit: 8500,  debit: 0    },
  { id: 4,  name: 'Suresh Babu',   work: 'Packaging',        date: '2026-01-18T14:20:00.000Z', credit: 0,     debit: 650  },
  { id: 5,  name: 'Priya Nair',    work: 'Photography',      date: '2026-01-25T16:45:00.000Z', credit: 3200,  debit: 0    },
  { id: 6,  name: 'Kiran Raj',     work: 'Flex Board',       date: '2026-02-02T08:00:00.000Z', credit: 0,     debit: 900  },
  { id: 7,  name: 'Anitha S',      work: 'Brochure',         date: '2026-02-06T09:30:00.000Z', credit: 2100,  debit: 0    },
  { id: 8,  name: 'Deepak Menon',  work: 'Visiting Cards',   date: '2026-02-10T11:15:00.000Z', credit: 0,     debit: 400  },
  { id: 9,  name: 'Lakshmi P',     work: 'Banner Printing',  date: '2026-02-14T13:00:00.000Z', credit: 4700,  debit: 0    },
  { id: 10, name: 'Vijay Thomas',  work: 'Sticker Design',   date: '2026-02-19T15:30:00.000Z', credit: 0,     debit: 750  },
  { id: 11, name: 'Santha Mary',   work: 'Letterhead',       date: '2026-02-23T10:00:00.000Z', credit: 1800,  debit: 0    },
  { id: 12, name: 'Arun Prakash',  work: 'T-Shirt Print',    date: '2026-03-01T09:45:00.000Z', credit: 0,     debit: 2200 },
  { id: 13, name: 'Divya R',       work: 'Catalogue',        date: '2026-03-04T11:30:00.000Z', credit: 6300,  debit: 0    },
  { id: 14, name: 'Manoj Kumar',   work: 'Offset Printing',  date: '2026-03-07T14:00:00.000Z', credit: 0,     debit: 3100 },
  { id: 15, name: 'Reshma Biju',   work: 'Social Media Post',date: '2026-03-10T10:15:00.000Z', credit: 2800,  debit: 0    },
  { id: 16, name: 'George P',      work: 'Envelope Print',   date: '2026-03-12T16:00:00.000Z', credit: 0,     debit: 520  },
  { id: 17, name: 'Nisha Antony',  work: 'Digital Marketing',date: '2026-03-14T09:00:00.000Z', credit: 5500,  debit: 0    },
  { id: 18, name: 'Biju Varghese', work: 'Invoice Design',   date: '2026-03-16T11:45:00.000Z', credit: 0,     debit: 870  },
  { id: 19, name: 'Sreeja Mohan',  work: 'Poster Design',    date: '2026-03-17T14:30:00.000Z', credit: 4100,  debit: 0    },
  { id: 20, name: 'Rahul Das',     work: 'Label Printing',   date: '2026-03-19T08:50:00.000Z', credit: 0,     debit: 1350 },
]

function App() {
  const [entries, setEntries] = useState(() => {
    const savedSeed = Number(localStorage.getItem(SEED_KEY) || 0)
    if (savedSeed < SEED_VERSION) {
      localStorage.setItem(SEED_KEY, String(SEED_VERSION))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultEntries))
      return defaultEntries
    }
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
        <h1>Ledger</h1>

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
