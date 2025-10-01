-- Function to get analysis summary statistics
CREATE OR REPLACE FUNCTION get_analysis_summary()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    total_requests INT;
    total_cost NUMERIC;
    avg_confidence NUMERIC;
    avg_input_tokens NUMERIC;
    avg_output_tokens NUMERIC;
    model_usage json;
    country_distribution json;
    confidence_levels json;
    result json;
BEGIN
    -- Calculate total requests
    SELECT COUNT(*) INTO total_requests FROM analysis_results;
    
    -- Calculate total cost and average confidence
    SELECT 
        COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
        COALESCE(AVG(confidence_score), 0) as avg_confidence
    INTO total_cost, avg_confidence
    FROM analysis_results;
    
    -- Calculate average tokens
    SELECT 
        COALESCE(AVG(input_tokens), 0) as avg_input_tokens,
        COALESCE(AVG(output_tokens), 0) as avg_output_tokens
    INTO avg_input_tokens, avg_output_tokens
    FROM analysis_results;
    
    -- Get model usage statistics
    SELECT json_agg(model_stats)
    INTO model_usage
    FROM (
        SELECT 
            analysis_provider as "modelName",
            COUNT(*) as count,
            COALESCE(AVG(estimated_cost_usd), 0) as "avgCost",
            COALESCE(AVG(confidence_score), 0) as "avgConfidence",
            COALESCE(AVG(execution_time_ms) FILTER (WHERE execution_time_ms IS NOT NULL), 0) as "avgExecutionTimeMs"
        FROM analysis_results
        GROUP BY analysis_provider
        ORDER BY count DESC
    ) as model_stats;
    
    -- Get country distribution
    SELECT json_agg(country_stats)
    INTO country_distribution
    FROM (
        SELECT 
            COALESCE(requester_geo->>'country', 'Unknown') as country,
            COUNT(*) as count
        FROM images
        WHERE requester_geo IS NOT NULL
        GROUP BY country
        ORDER BY count DESC
    ) as country_stats;
    
    -- Get confidence level distribution
    SELECT json_agg(confidence_stats)
    INTO confidence_levels
    FROM (
        SELECT 
            confidence_level_calc,
            COUNT(*) as count
        FROM (
            SELECT 
                CASE
                    WHEN confidence_level IS NOT NULL THEN confidence_level
                    WHEN confidence_score >= 0.97 THEN 'HIGH'
                    WHEN confidence_score >= 0.92 THEN 'MEDIUM'
                    ELSE 'LOW'
                END as confidence_level_calc
            FROM analysis_results
        ) as subquery
        GROUP BY confidence_level_calc
        ORDER BY 
            CASE 
                WHEN confidence_level_calc = 'HIGH' THEN 1
                WHEN confidence_level_calc = 'MEDIUM' THEN 2
                WHEN confidence_level_calc = 'LOW' THEN 3
                ELSE 4
            END
    ) as confidence_stats;
    
    -- Build final result object
    SELECT json_build_object(
        'totalRequests', total_requests,
        'totalCost', total_cost,
        'avgConfidence', avg_confidence,
        'avgInputTokens', avg_input_tokens,
        'avgOutputTokens', avg_output_tokens,
        'modelUsage', COALESCE(model_usage, '[]'::json),
        'countryDistribution', COALESCE(country_distribution, '[]'::json),
        'confidenceLevels', COALESCE(confidence_levels, '[]'::json)
    ) INTO result;
    
    RETURN result;
END;
$$;
