const request = require('supertest');
const app = require('./server'); // Import your Express app

describe('POST /check-conditions', () => {
    it('should respond with 200 for scheduling condition', async () => {
        const res = await request(app)
            .post('/check-conditions')
            .send({
                conditionType: 'scheduling',
                userData: {
                    name: 'Moazzam',
                    phone: '+923346250250',
                    preferredTime: '10:00 AM'
                }
            });
        
        expect(res.statusCode).toEqual(200);
        expect(res.text).toEqual('Condition processed'); // Check if it matches expected response
    });

    it('should handle reminder condition and send SMS', async () => {
        const res = await request(app)
            .post('/check-conditions')
            .send({
                conditionType: 'reminder',
                userData: {
                    name: 'Moazzam',
                    phone: '+923346250250'
                }
            });
        
        expect(res.statusCode).toEqual(200);
        expect(res.text).toEqual('Condition processed');
    });
});
