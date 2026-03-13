UPDATE users
SET plan_id = 'basic'
WHERE plan_id = 'free';

UPDATE subscriptions
SET plan_id = 'basic'
WHERE plan_id = 'free';
