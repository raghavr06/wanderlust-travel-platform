const env = require('../../config/env');

class NuiteeClient {
    constructor() {
        this.apiKey = env.nuitee.apiKey;
        this.apiUrl = env.nuitee.apiUrl || 'https://api.liteapi.travel/v3.0';
        this.bookUrl = 'https://book.liteapi.travel/v3.0';
    }

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey || '',
            'x-api-key': this.apiKey || ''
        };
    }

    // Step 0: Search Hotels
    async fetchHotelsByCity({ countryCode = 'US', cityName = 'New York', limit = 10 } = {}) {
        if (!this.apiKey) {
            console.warn("[Nuitee] NUITEE_API_KEY is not set. Skipping live fetch.");
            return [];
        }

        try {
            const url = `${this.apiUrl}/data/hotels?countryCode=${encodeURIComponent(countryCode)}&cityName=${encodeURIComponent(cityName)}&limit=${limit}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders()
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[Nuitee API Error] ${response.status}: ${errText}`);
                return [];
            }

            const data = await response.json();
            return data.data || data.hotels || data || [];
        } catch (err) {
            console.error("[Nuitee Client Error]", err.message);
            return [];
        }
    }

    // Step 1: Check hotel rates & availability -> returns offerId
    async searchRates({ hotelId, checkIn, checkOut, adultCount = 2, currency = 'USD' } = {}) {
        if (!this.apiKey) {
            console.warn("[Nuitee] NUITEE_API_KEY is not set.");
            return null;
        }

        try {
            const url = `${this.apiUrl}/rates`;
            const payload = {
                hotelIds: [hotelId],
                checkin: checkIn,
                checkout: checkOut,
                occupancies: [{ adults: adultCount, children: [] }],
                currency
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[Nuitee Search Rates Error] ${response.status}: ${errText}`);
                return null;
            }

            const result = await response.json();
            return result;
        } catch (err) {
            console.error("[Nuitee Search Rates Exception]", err.message);
            return null;
        }
    }

    // Step 2: Make a Prebook -> returns prebookId
    async prebook({ offerId, usePaymentSdk = false }) {
        if (!this.apiKey) {
            throw new Error("NUITEE_API_KEY is required for prebooking");
        }

        try {
            const url = `${this.bookUrl}/rates/prebook`;
            const payload = {
                usePaymentSdk,
                offerId
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (!response.ok) {
                console.error("[Nuitee Prebook Error]", result);
                throw new Error(result.message || result.error || "Nuitee Prebook failed");
            }

            return result;
        } catch (err) {
            console.error("[Nuitee Prebook Exception]", err.message);
            throw err;
        }
    }

    // Step 3: Confirm Booking -> completes booking
    async confirmBooking({ prebookId, holder, guests, payment }) {
        if (!this.apiKey) {
            throw new Error("NUITEE_API_KEY is required for booking confirmation");
        }

        try {
            const url = `${this.bookUrl}/rates/book`;
            const payload = {
                holder: holder || {
                    firstName: "Steve",
                    lastName: "Doe",
                    email: "s.doe@liteapi.travel",
                    phone: "0200923695"
                },
                guests: guests || [
                    {
                        occupancyNumber: 1,
                        firstName: "Sunny",
                        lastName: "Mars",
                        email: "s.mars@liteapi.travel"
                    }
                ],
                payment: payment || {
                    method: "ACC_CREDIT_CARD"
                },
                prebookId
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (!response.ok) {
                console.error("[Nuitee Book Error]", result);
                throw new Error(result.message || result.error || "Nuitee Booking confirmation failed");
            }

            return result;
        } catch (err) {
            console.error("[Nuitee Confirm Booking Exception]", err.message);
            throw err;
        }
    }
}

module.exports = new NuiteeClient();
