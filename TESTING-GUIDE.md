# WanderLust Testing Guide

Everything here was verified working in this session. The app is a classic layered Express + Mongoose
app (routes -> controller -> service -> model) with Redis caching, Redis-backed sessions, BullMQ jobs,
and instant (host-less) room booking.

## 0. Prerequisites & getting it running

| Service | Where | Health check |
|---|---|---|
| MongoDB | `mongodb://127.0.0.1:27017/wanderlust` | `mongosh --eval "db.runCommand({ping:1})"` |
| Redis | Docker container `wanderlust-redis` on `127.0.0.1:6380` | `docker ps` |
| App | `http://localhost:8080` | `curl -s -o NUL -w "%{http_code}" http://localhost:8080/` -> 200 |

Start things in this order:

```powershell
# 1) Redis (if the container is stopped after a reboot)
docker start wanderlust-redis

# 2) (Optional) re-seed a pristine database with rooms per category
node init/index.js          # wipes listings only, keeps users

# 3) Start the app
npm run dev                 # or: node app.js
```

Demo accounts (already seeded):
- Host:  `demo-host`  / `booklub123`
- Guest: `demo-guest` / `booklub123`

Run the automated test suite any time: `npm test` (expect `1 passed`).

---

## 1. Browsing & discoverability

Browser steps:
1. `http://localhost:8080/` -> home page with hero + category tiles + featured listings.
2. Click **Explore** -> `/listings` shows all 29 listings as cards.
3. Use the **Search** box (e.g. `cozy`, `cabin`).
4. Category chips: `/listings?category=Domes`, `/listings?category=Mountains`.
4. Sort dropdown: `price_asc` (Low to High), `price_desc` (High to Low), `rating` (Top rated).
   Sorting is applied at the database level, and every filter dimension (search, category, country,
   price range, sort, limit) is part of the Redis cache key, so a sorted page can never be served a
   stale/unsorted result. There is no numeric-precision quirk: cards show the cheapest room's price,
   which is the exact field used for sorting.
6. Click any card -> detail page.

Detail page checks (very important, new feature):
- A **Rooms & availability** card lists each room with its guest capacity, price, and per-room
  booked nights (`Available for all upcoming dates` when free). Each row says how many guests that
  room seats, so it never conflicts with the booking form.
- The header shows `Up to N guests across M rooms` (N is the TOTAL across all rooms), while the
  booking widget is per-room and always caps the guests at the **selected room's** limit
  (`(max 2 for Standard Room)`). Those are different numbers on purpose — a booking is for one room.
- A clock line states the house rule: **check-in from 12:00 PM, check-out by 10:00 AM**.
- The booking widget has a **Select room** dropdown, check-in, check-out, and guests inputs.
- The price estimate updates per **selected room** × nights (Deluxe costs more than Standard).

Verify with curl (optional):
```powershell
curl -s "http://localhost:8080/listings?category=Domes" -o NUL -w "%{http_code}"   # 200
curl -s "http://localhost:8080/listings/BOOKED" -o NUL -w "%{http_code}"          # show page 200
curl -s "http://localhost:8080/listings/ID/bookings/availability"                  # JSON availability
```

---

## 2. Authentication

1. Sign up at `/signup` (any email + username), you are logged in automatically.
2. Log out via **Logout**, log back in at `/login` with `demo-host` / `booklub123`.
3. Hitting a protected page while logged out redirects to `/login` with a flash message.

---

## 3. Instant booking — no host confirmation (core change)

Guest flow (log in as `demo-guest`):
1. Open a listing, pick a **room**, pick future dates, adjust guests (capped by room capacity).
2. Click **Confirm booking**. You are redirected back with a green alert:
   `Booking confirmed! The host has been notified.`
3. The booking is **CONFIRMED immediately** — there is no "Request to book / host approves" step
   anymore. Confirm at `/profile`: status badge is green `CONFIRMED`, room name + price shown.

Host side:
1. Log in as `demo-host`, open `/dashboard`.
2. Same booking appears at the top of the **Bookings** table with Guest, Listing, **Room**, Dates,
   Guests, Total, and `CONFIRMED` badge.
3. There are **no Confirm / Reject buttons** anywhere. Revenue stat increases by booking total.

Notifications:
- Guest bell -> `/notifications` shows `Booking confirmed ... (Room) ...`.
- Host bell -> `/notifications` shows `New booking ... (Room) ...`.

Quick curl helper (points at the first listing, first room):
```powershell
# get a listing id + first room id
node -e "require('dotenv').config(); const m=require('mongoose'); m.connect('mongodb://127.0.0.1:27017/wanderlust').then(async()=>{const L=require('./src/modules/listings/listing.model.js'); const l=await L.findOne().lean(); console.log(l._id, l.rooms[0]._id); process.exit(0)})"

# book it as the guest (session cookie in wl-g.txt from a login)
curl -s -b Cookie.txt -o NUL -w "%{http_code}" `
  --data-urlencode "checkIn=2026-10-01" --data-urlencode "checkOut=2026-10-04" `
  --data-urlencode "guests=1" --data-urlencode "roomId=ROOMID" `
  "http://localhost:8080/listings/LISTINGID/bookings"        # 302
```

---

## 4. Per-room availability & the 12 PM / 10 AM rule

The house rule is enforced with real timestamps on every booking:
- check-in = **12:00 PM** on the check-in date, check-out = **10:00 AM** on the check-out date.
- A booking thus owns the **nights** `checkIn .. checkOut-1` and frees the room at 10:00 AM on the
  check-out date.

1. As guest, book `Standard Room` for `Sept 8` → `Sept 9` (this occupies the night of the 8th).
2. Reload the listing page:
   - The **Standard Room** row shows `Not available: 8 Sep` (the occupied nights only).
   - The room's booking-widget calendar greys out the 8th.
   - **Deluxe Room** is untouched and still fully bookable for the same dates.
3. Same-day turnover: book `Standard Room` again for `Sept 9` → `Sept 12`. It **succeeds** —
   the room was free again at 10:00 AM on the 9th, so a 12:00 PM check-in on the 9th is valid.
4. Book the same room for `Sept 8` → `Sept 11` → **rejected** (`"Standard Room" is already booked
   for part of those dates`) because the 8th night is still taken.
5. Verify the stored timestamps:
   ```bash
   node -e "require('dotenv').config();const m=require('mongoose');m.connect('mongodb://127.0.0.1:27017/wanderlust').then(async()=>{const B=require('./src/modules/bookings/booking.model.js');const b=await B.findOne().lean();console.log(b.checkIn,b.checkOut);process.exit(0)})"
   # => ...T06:30:00Z ...T04:30:00Z  (= 12:00 PM / 10:00 AM IST)
   ```
6. Open host `/dashboard` or a listing's **Manage availability** page to see `Rooms & booked ranges`
   with each room's occupied nights.

Curl:
```powershell
curl -s "http://localhost:8080/listings/ID/bookings/availability"
# => {"rooms":[{...,"disabled":[{"from":"...","to":"..."}]}],"blocked":[...]}
#    disabled = occupied NIGHTS of the room; blocked = host-blocked full days
```

---

## 5. Double-booking prevention (incl. concurrency)

Sequential case:
1. While `Standard Room` is booked for X→Y, try to book **the same room** for an overlapping
   range (e.g. X+1→Y+1) as `demo-guest`.
2. You are redirected with a red alert: `"Standard Room" is already booked for part of those dates`
   and **no new booking is created**.
3. Booking another room for the same dates **succeeds** (rooms are independent).
4. Edge cases with the 12 PM / 10 AM rule:
   - next guest check-in on the **same day** as the previous guest's check-out → **succeeds**
     (this is the intended chain: 8–9 Sep followed by 9–12 Sep).
   - check-in on the previous guest's check-in night → **rejected**.
   - a host-blocked date only blocks its own night: blocking `Sept 25` rejects a `Sept 25–26`
     booking but **allows** `Sept 26–27`.

Concurrent case (two guests / two tabs at once) — run these two in parallel:
```powershell
curl -s -b CookieA.txt -o NUL -w "$(http_code)\n" `
  --data-urlencode "checkIn=2026-10-10" --data-urlencode "checkOut=2026-10-13" `
  --data-urlencode "guests=1" --data-urlencode "roomId=ROOMID" `
  "http://localhost:8080/listings/ID/bookings"

curl -s -b CookieB.txt -o NUL -w "$(http_code)\n" `   # same payload, second session
  ...
```
Then in MongoDB exactly **one** overlapping CONFIRMED booking must exist:
```powershell
node -e "require('dotenv').config(); const m=require('mongoose'); m.connect('mongodb://127.0.0.1:27017/wanderlust').then(async()=>{const B=require('./src/modules/bookings/booking.model.js'); const n=await B.countDocuments({roomId:new m.Types.ObjectId('ROOMID'),status:'CONFIRMED',checkIn:{ $lt:new Date('2026-10-13')},checkOut:{ $gt:new Date('2026-10-10')}}); console.log(n); process.exit(0)})"   # prints 1
```
The other request gets the "already booked" flash. This is enforced server-side with a Mongo
transaction + a `lockVersion` write on the parent listing (`booking.service.js`), so even two
simultaneous requests cannot both win.

---

## 6. Cancellation

1. As `demo-guest`, `/profile` -> **Cancel booking** on a future stay.
2. Card turns `CANCELLED`; the host gets a `Booking cancelled` notification (`/dashboard` bell).
3. The room's dates become bookable again:
   `curl -s http://localhost:8080/listings/ID/bookings/availability` no longer shows that range.

---

## 7. Host listing management (rooms)

Add a listing:
1. `/dashboard` -> **Add Listing** (`/listings/new`).
2. Fill title/description/location/country, choose a **category** (drives the suggested rooms),
   set base **price** and **max guests**, tick amenities.
3. Use **+ Add room** to add rooms (name / max guests / price each). If you add none, a default
   "Standard Room" is created from the base price.
4. Submit. The listing card price = cheapest room; max guests = sum of all room capacities.

Edit / delete:
1. Open your listing -> **Edit listing** -> room rows are pre-filled; add/rename/reprice, save.
2. **Delete listing** on the detail page; afterwards the URL returns a proper 404 page.

Curl versions use `listing[rooms][0][name]` etc. with `multipart/form-data`:
```powershell
curl -s -b HostCookie.txt -o NUL -w "%{http_code}" `
  -F "listing[title]=T" -F "listing[description]=d" -F "listing[location]=L" `
  -F "listing[country]=India" -F "listing[price]=1800" -F "listing[category]=Farms" `
  -F "listing[maxGuests]=6" `
  -F "listing[rooms][0][name]=Farm Cottage"  -F "listing[rooms][0][maxGuests]=2" -F "listing[rooms][0][price]=1800" `
  -F "listing[rooms][1][name]=Homestead"     -F "listing[rooms][1][maxGuests]=4" -F "listing[rooms][1][price]=2400" `
  "http://localhost:8080/listings"            # 302
```

Block dates (host):
1. On your listing -> **Manage availability**.
2. Select a range in the calendar -> **Block selected dates** (e.g. `Sept 25`).
3. The night of each blocked date becomes unbookable: a guest with check-in `Sept 25` is rejected
   server-side and the widget greys the 25th; guests checking in on the 26th are unaffected.
4. **Unblock** removes them. (Both block and unblock use local-calendar dates — no UTC off-by-one.)

---

## 8. Reviews

1. As `demo-guest` on any listing -> leave a 5-star review with a comment.
2. It appears under **Reviews**, updates the rating badge (e.g. `5 (1)`).
3. Reviewing the **same listing again** is rejected: `You have already reviewed this listing`.
4. As `demo-host`, reviewing your **own** listing is rejected: `You cannot review your own listing`.
5. Review author can delete their own review.

---

## 9. Redis — verify it is actually working

The app uses Redis for: (a) session store, (b) listings cache, (c) BullMQ.

Check the cache (populated after browsing):
```powershell
docker exec wanderlust-redis redis-cli --scan --pattern "listings:*"
# => listings:q::c::s:rating:l:8          (featured/home page)
# => listings:q::c::s:price_asc:l:        (search results)
# => listings:ID                            (detail page cache)
docker exec wanderlust-redis redis-cli --scan --pattern "listings:*" | wc -l
```

Show the session store is live (cookie sessions persisted in Redis):
```powershell
docker exec wanderlust-redis redis-cli --scan --pattern "sess:*"
# => sess:...  (one key per logged-in session)
```

Ping + throughput:
```powershell
docker exec wanderlust-redis redis-cli ping          # PONG
docker exec wanderlust-redis redis-cli dbsize        # >0 keys
```

Proof that Redis is being USED, not just running: browse the home page once, delete one cache key
with `redis-cli del listings:…`, refresh — it is back (re-cached from Mongo) and `dbsize` grows.

---

## 10. BullMQ — verify the queue + worker

Every instantly-confirmed booking enqueues a `booking-confirmed` job on queue `booking-events`; a
worker (started with the app) processes it and logs to the app console:

```
[bullmq] booking-confirmed: #... Cozy Beachfront Cottage (Standard Room) for 2 guest(s), nights=2
[bullmq] job 1 completed
```

Observe the queue in Redis (these live keys prove producer + consumer work):

```powershell
# job counters (waiting / active / completed / failed)
docker exec wanderlust-redis redis-cli llen "bull:booking-events:wait"
docker exec wanderlust-redis redis-cli zcount "bull:booking-events:completed" -inf +inf
docker exec wanderlust-redis redis-cli zcount "bull:booking-events:failed" -inf +inf

# list completed job ids + timestamps
docker exec wanderlust-redis redis-cli zrange "bull:booking-events:completed" 0 -1 WITHSCORES
```

Test recipe:
1. Note the completed count (`zcount ... completed -inf +inf`).
2. Book one more room as the guest.
3. Re-run the count a second later -> it increased by exactly **1**.
4. The app console shows the matching `[bullmq]` log line.

Because the worker lives in the same process as the API (see `src/modules/bookings/booking.queue.js`),
you do not need a separate worker command while testing.

---

## 11. Quick sanity checklist

- [ ] `npm test` -> 1 passing suite
- [ ] `/`, `/listings`, `/terms`, `/privacy` -> 200
- [ ] unauthenticated `/profile`, `/dashboard` -> redirect to `/login`
- [ ] instant booking -> `CONFIRMED` on `/profile` and `/dashboard`, 2 notifications (guest+host)
- [ ] same room + overlapping dates -> rejected with flash; **count remains 1**
- [ ] different room, same dates -> allowed
- [ ] concurrent identical requests -> **exactly one** booking in Mongo
- [ ] cancel -> `CANCELLED`, dates free again, host notified
- [ ] host blocks a date range -> guests can't book it (server 409 + calendar greyed)
- [ ] `docker exec wanderlust-redis redis-cli --scan --pattern "listings:*"` -> non-empty after browsing
- [ ] `docker exec wanderlust-redis redis-cli zcount "bull:booking-events:completed" -inf +inf` grows on each booking