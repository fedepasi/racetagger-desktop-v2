-- Function to get API usage per user with cost analysis
CREATE OR REPLACE FUNCTION get_api_usage_by_user(
    period_days INT DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
BEGIN
    -- Get user-specific usage data for the specified period
    SELECT json_agg(user_data)
    INTO result
    FROM (
        SELECT 
            i.user_id,
            COALESCE(u.email, 'Unknown') as user_email,
            COUNT(ar.id) as request_count,
            SUM(ar.estimated_cost_usd) as total_cost,
            AVG(ar.confidence_score) as avg_confidence,
            MAX(ar.analyzed_at) as last_usage,
            -- Special flags for demo and admin users
            CASE WHEN i.user_id = 'f25ae3ba-8c7b-4400-bf75-cea40605aaf9' THEN true ELSE false END as is_demo_user,
            CASE WHEN i.user_id = '12ad7060-5914-4868-b162-9b846580af21' THEN true ELSE false END as is_admin_user,
            -- Usage by day for time series
            json_agg(json_build_object(
                'date', date_trunc('day', ar.analyzed_at)::date,
                'count', COUNT(ar.id),
                'cost', SUM(ar.estimated_cost_usd)
            ) ORDER BY date_trunc('day', ar.analyzed_at)::date) as daily_usage
        FROM 
            images i
        JOIN 
            analysis_results ar ON i.id = ar.image_id
        LEFT JOIN
            auth.users u ON i.user_id = u.id
        WHERE 
            ar.analyzed_at >= NOW() - (period_days || ' days')::interval
        GROUP BY 
            i.user_id, u.email
        ORDER BY 
            total_cost DESC
    ) as user_data;

    RETURN json_build_object(
        'userStats', COALESCE(result, '[]'::json),
        'period_days', period_days
    );
END;
$$;

-- Function to get global API usage statistics
CREATE OR REPLACE FUNCTION get_global_api_statistics(
    period_days INT DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    total_requests INT;
    total_cost NUMERIC;
    total_users INT;
    daily_usage json;
    result json;
BEGIN
    -- Calculate total requests for period
    SELECT COUNT(*) 
    INTO total_requests 
    FROM analysis_results
    WHERE analyzed_at >= NOW() - (period_days || ' days')::interval;
    
    -- Calculate total cost for period
    SELECT COALESCE(SUM(estimated_cost_usd), 0) 
    INTO total_cost
    FROM analysis_results
    WHERE analyzed_at >= NOW() - (period_days || ' days')::interval;
    
    -- Count unique users
    SELECT COUNT(DISTINCT i.user_id)
    INTO total_users
    FROM images i
    JOIN analysis_results ar ON i.id = ar.image_id
    WHERE ar.analyzed_at >= NOW() - (period_days || ' days')::interval
    AND i.user_id IS NOT NULL;
    
    -- Get daily usage for trend analysis
    SELECT json_agg(daily_data ORDER BY date)
    INTO daily_usage
    FROM (
        SELECT 
            date_trunc('day', analyzed_at)::date as date,
            COUNT(*) as request_count,
            SUM(estimated_cost_usd) as daily_cost
        FROM analysis_results
        WHERE analyzed_at >= NOW() - (period_days || ' days')::interval
        GROUP BY date
    ) as daily_data;
    
    -- Build final result object
    SELECT json_build_object(
        'totalRequests', total_requests,
        'totalCost', total_cost,
        'totalUsers', total_users,
        'dailyUsage', COALESCE(daily_usage, '[]'::json),
        'periodDays', period_days
    ) INTO result;
    
    RETURN result;
END;
$$;
