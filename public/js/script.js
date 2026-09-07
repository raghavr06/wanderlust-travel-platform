// Bootstrap validation for all .needs-validation forms
(() => {
  'use strict'

  const forms = document.querySelectorAll('.needs-validation')

  Array.from(forms).forEach(form => {
    form.addEventListener('submit', event => {
      if (!form.checkValidity()) {
        event.preventDefault()
        event.stopPropagation()
      }

      form.classList.add('was-validated')
    }, false)
  })
})()

// Room editor for listing new/edit forms
(() => {
  const container = document.getElementById('rooms-container')
  const addBtn = document.getElementById('add-room-btn')
  const tpl = document.getElementById('room-row-template')
  if (!container || !addBtn || !tpl) return

  let idx = container.querySelectorAll('.room-row').length

  const addRow = (name = '', maxGuests = '', price = '') => {
    const row = tpl.content.cloneNode(true)
    const inputs = row.querySelectorAll('input')
    inputs[0].name = `listing[rooms][${idx}][name]`
    inputs[0].value = name
    inputs[1].name = `listing[rooms][${idx}][maxGuests]`
    inputs[1].value = maxGuests
    inputs[2].name = `listing[rooms][${idx}][price]`
    inputs[2].value = price
    container.appendChild(row)
    idx++
  }

  addBtn.addEventListener('click', () => addRow())
  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-room')) {
      e.target.closest('.room-row').remove()
    }
  })
})()

// Booking widget: per-room availability-aware calendar + live price estimate
(() => {
  const widget = document.getElementById('booking-widget')
  if (!widget) return

  const checkIn = document.getElementById('checkIn')
  const checkOut = document.getElementById('checkOut')
  const roomSelect = document.getElementById('roomId')
  const guestsInput = document.getElementById('guests')
  const guestsHint = document.getElementById('guests-hint')
  const nightsEl = document.getElementById('nights-count')
  const rateEl = document.getElementById('rate-label')
  const totalEl = document.getElementById('total-price')
  const breakdown = document.getElementById('price-breakdown')

  if (!checkIn || !checkOut || !roomSelect) return

  // Build per-room disabled ranges from server-side availability payload
  let roomRanges = [] // { key: roomId string, disabled: [{from, to}] }
  let listingBlocked = []
  const raw = document.getElementById('booking-availability')
  if (raw) {
    try {
      const data = JSON.parse(raw.textContent)
      roomRanges = (data.rooms || []).map(r => ({
        key: String(r._id),
        disabled: (r.disabled || []).map(range => ({
          from: range.from.slice(0, 10),
          to: range.to.slice(0, 10)
        }))
      }))
      listingBlocked = (data.blocked || []).map(range => ({
        from: range.from.slice(0, 10),
        to: range.to.slice(0, 10)
      }))
    } catch (err) {
      roomRanges = []
      listingBlocked = []
    }
  }

  const currentRoomId = () => roomSelect ? roomSelect.value : null
  const currentRoomOption = () => {
    if (!roomSelect) return null
    const opt = Array.from(roomSelect.options).find(o => o.value === currentRoomId())
    return opt || (roomSelect.options.length ? roomSelect.options[0] : null)
  }
  const roomPrice = () => {
    const opt = currentRoomOption()
    return opt ? (Number(opt.dataset.price) || 0) : 0
  }
  const roomGuestsMax = () => {
    const opt = currentRoomOption()
    return opt ? (Number(opt.dataset.maxGuests) || Infinity) : Infinity
  }

  const disabledForRoom = () => {
    if (listingBlocked.length) return listingBlocked
    const found = roomRanges.find(r => r.key === String(currentRoomId()))
    return (found && found.disabled) ? found.disabled : (roomRanges[0] ? roomRanges[0].disabled : [])
  }

  let fpIn = null
  let fpOut = null
  const buildCalendars = () => {
    if (fpIn) fpIn.destroy()
    if (fpOut) fpOut.destroy()
    const disabled = disabledForRoom()
    fpIn = flatpickr(checkIn, {
      minDate: 'today',
      dateFormat: 'Y-m-d',
      disable: disabled,
      onChange: (selectedDates, dateStr) => {
        if (selectedDates[0]) fpOut.set('minDate', dateStr)
        updateEstimate()
      }
    })
    fpOut = flatpickr(checkOut, {
      minDate: 'today',
      dateFormat: 'Y-m-d',
      disable: disabled,
      onChange: updateEstimate
    })
  }

  const updateEstimate = () => {
    if (!checkIn.value || !checkOut.value) {
      if (breakdown) breakdown.classList.add('d-none')
      return
    }
    const start = new Date(checkIn.value + 'T00:00:00')
    const end = new Date(checkOut.value + 'T00:00:00')
    const nights = Math.round((end - start) / 86400000)
    if (!(nights > 0)) {
      if (breakdown) breakdown.classList.add('d-none')
      return
    }
    const rate = roomPrice()
    const total = nights * rate
    if (rateEl) rateEl.textContent = '\u20B9 ' + rate.toLocaleString('en-IN')
    nightsEl.textContent = nights
    totalEl.textContent = '\u20B9 ' + total.toLocaleString('en-IN')
    breakdown.classList.remove('d-none')
  }

  const syncRoom = () => {
    if (guestsInput) {
      const max = roomGuestsMax()
      guestsInput.max = max
      const opt = currentRoomOption()
      const roomName = opt ? opt.textContent.split('—')[0].trim() : 'selected room'
      if (guestsHint) guestsHint.textContent = '(max ' + max + ' for ' + roomName + ')'
      if (Number(guestsInput.value) > max) guestsInput.value = max
    }
    buildCalendars()
    updateEstimate()
  }

  if (roomSelect) roomSelect.addEventListener('change', syncRoom)
  if (guestsInput) {
    guestsInput.addEventListener('change', () => {
      const max = roomGuestsMax()
      if (guestsInput.value < 1) guestsInput.value = 1
      if (guestsInput.value > max) guestsInput.value = max
    })
  }

  const guardOverlapOnSubmit = (e) => {
    if (!checkIn.value || !checkOut.value) return
    const start = new Date(checkIn.value + 'T00:00:00')
    const end = new Date(checkOut.value + 'T00:00:00')
    const overlaps = disabledForRoom().some(range => {
      const rFrom = new Date(range.from + 'T00:00:00')
      const rTo = new Date(range.to + 'T00:00:00')
      const rToNext = new Date(rTo)
      rToNext.setDate(rToNext.getDate() + 1)
      return start < rToNext && end > rFrom
    })
    if (overlaps) {
      e.preventDefault()
      e.stopPropagation()
      alert('Those dates overlap an existing booking or a blocked date. Please pick different dates.')
    }
  }

  const form = widget.querySelector('form')
  if (form) form.addEventListener('submit', guardOverlapOnSubmit)

  syncRoom()
})()