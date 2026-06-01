"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Create a new turf (by Owner)
router.post('/', async (req, res) => {
    const { ownerId, name, location, pricePerHour } = req.body;
    try {
        const turf = await prisma.turf.create({
            data: {
                ownerId,
                name,
                location,
                pricePerHour
            }
        });
        res.status(201).json(turf);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create turf' });
    }
});
// Get all turfs
router.get('/', async (req, res) => {
    try {
        const { status, ownerId } = req.query;
        const whereClause = {};
        if (status) {
            // Support uppercase status comparing
            whereClause.status = String(status).toUpperCase();
        }
        if (ownerId) {
            whereClause.ownerId = String(ownerId);
        }
        const turfs = await prisma.turf.findMany({
            where: whereClause,
            include: { reviews: true }
        });
        res.json(turfs);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch turfs' });
    }
});
// Get single turf
router.get('/:id', async (req, res) => {
    try {
        const turf = await prisma.turf.findUnique({
            where: { id: String(req.params.id) },
            include: { reviews: true }
        });
        if (!turf) {
            return res.status(404).json({ error: 'Turf not found' });
        }
        res.json(turf);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch turf' });
    }
});
// Update turf status (for Super Admin)
router.put('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!status || !['PENDING', 'APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const turf = await prisma.turf.update({
            where: { id: String(req.params.id) },
            data: { status: status.toUpperCase() }
        });
        res.json(turf);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update turf status' });
    }
});
// Get turf reviews
router.get('/:id/reviews', async (req, res) => {
    try {
        const reviews = await prisma.review.findMany({
            where: { turfId: String(req.params.id) },
            include: { user: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(reviews);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});
// Post a review
router.post('/:id/reviews', async (req, res) => {
    try {
        const { userId, rating, comment } = req.body;
        const turfId = String(req.params.id);
        // Check if user already reviewed
        const existing = await prisma.review.findUnique({
            where: {
                userId_turfId: { userId, turfId }
            }
        });
        if (existing) {
            return res.status(400).json({ error: 'You have already reviewed this turf.' });
        }
        const review = await prisma.review.create({
            data: { rating, comment, userId, turfId }
        });
        res.status(201).json(review);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create review' });
    }
});
exports.default = router;
