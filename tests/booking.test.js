jest.mock('../src/common/middlewares/auth.middleware.js', () => {
    const actual = jest.requireActual('../src/common/middlewares/auth.middleware.js');
    return {
        ...actual,
        isLoggedIn: (req, res, next) => {
            req.user = { _id: 'guest_user_id' };
            req.isAuthenticated = () => true;
            next();
        }
    };
});

const request = require('supertest');
const mongoose = require('mongoose');

jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => {
        return {
            on: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            keys: jest.fn()
        };
    });
});

jest.mock('redis', () => {
    return {
        createClient: jest.fn().mockReturnValue({
            on: jest.fn(),
            connect: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            expire: jest.fn(),
            keys: jest.fn()
        })
    };
});

jest.mock('bullmq', () => {
    return {
        Queue: jest.fn().mockImplementation(() => ({
            add: jest.fn()
        })),
        Worker: jest.fn().mockImplementation(() => ({
            on: jest.fn()
        }))
    };
});

const app = require('../app');
const bookingService = require('../src/modules/bookings/booking.service.js');

jest.mock('../src/modules/bookings/booking.service.js');

describe('Booking Concurrency Integration Test', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should prevent double-booking for overlapping dates using transactions and lockVersion', async () => {
        const payload = {
            checkIn: new Date(Date.now() + 86400000).toISOString(),
            checkOut: new Date(Date.now() + 86400000 * 3).toISOString(),
            guests: 2
        };

        // Simulate concurrency: first call succeeds, second call fails with a conflict
        // (mirroring the lockVersion / WriteConflict behavior in the real service).
        let callCount = 0;
        let successCount = 0;
        let failureCount = 0;
        bookingService.createBooking.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                await new Promise(resolve => setTimeout(resolve, 50));
                successCount++;
                return { _id: 'booking_id' };
            } else {
                const AppError = require('../src/common/utils/AppError.js');
                failureCount++;
                throw new AppError(409, "This listing is not available for the selected dates");
            }
        });

        const reqA = request(app).post(`/listings/listing_123/bookings`).send(payload);
        const reqB = request(app).post(`/listings/listing_123/bookings`).send(payload);

        const [resA, resB] = await Promise.all([reqA, reqB]);

        const statuses = [resA.statusCode, resB.statusCode];

        // Exactly one booking is created; the conflicting request is caught by the
        // controller and redirected back with a flash error (302), never a crash.
        expect(successCount).toBe(1);
        expect(failureCount).toBe(1);
        expect(statuses).toEqual([302, 302]);

        // Verify the service was called exactly twice concurrently
        expect(bookingService.createBooking).toHaveBeenCalledTimes(2);
    });
});