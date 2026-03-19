const request = require('supertest');
const app = require('../app'); // Adjust path as necessary
const db = require('../db'); // Assuming you have a database connection file

jest.mock('openai'); // Mock OpenAI client

// Test data
const mockResponse = { tasks: [{ title: 'Test Task 1' }, { title: 'Test Task 2' }] };

describe('POST /api/upload', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should persist tasks and return created tasks', async () => {
        const response = await request(app)
            .post('/api/upload')
            .send({ image: 'fake-image-data' }); // Replace with actual fixture

        expect(response.status).toBe(200);
        expect(response.body.tasks).toEqual(mockResponse.tasks);

        const tasksInDB = await db.getTasks(); // Adjust DB call as necessary
        expect(tasksInDB).toEqual(mockResponse.tasks);
    });
});
