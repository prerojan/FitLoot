UPDATE users
SET
  plan_status = 'failed',
  payment_method = COALESCE(payment_method, 'none')
WHERE COALESCE(onboarding_completed, 0) = 0
  AND COALESCE(plan_id, 'basic') IN ('basic', 'free')
  AND COALESCE(plan_status, 'active') = 'active'
  AND COALESCE(payment_method, 'none') = 'none';
