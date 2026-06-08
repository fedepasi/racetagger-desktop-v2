-- Gemini 3.1 Flash-Lite vs Gemini 3.5 Flash regression benchmark.
-- Run: 2026-05-19. Set: motorsport_v3_large_2026-05 (1000 cases, 799 easy + 144 hard + 57 edge_case).
-- Edge function: run-regression-benchmark v8 (gemini-3.5-flash added to MODEL_PRICING).
-- pg_net required (installed via migration enable_pg_net_for_benchmark_invocation).
-- Auth: anon JWT (verify_jwt only checks signature, function uses service_role internally).
--
-- Launches 20 chunks in parallel: 10 per model, 100 cases each, offsets 0..900.
-- Each chunk writes a row to regression_benchmark_runs filtered via variant_notes.

DO $$
DECLARE
  v_offset int;
  v_model text;
  v_url text := 'https://taompbzifylmdzgbbrpv.supabase.co/functions/v1/run-regression-benchmark';
  v_anon_jwt text := current_setting('app.anon_jwt', true);
  v_headers jsonb;
  v_body jsonb;
  v_req_id bigint;
  v_notes_tag text := 'gemini_3.1_vs_3.5_comparison_2026-05-19';
BEGIN
  IF v_anon_jwt IS NULL OR v_anon_jwt = '' THEN
    RAISE EXCEPTION 'Set app.anon_jwt before running: SET app.anon_jwt = ''<your_anon_jwt>'';';
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_anon_jwt
  );

  FOR v_model IN SELECT unnest(ARRAY['gemini-3.1-flash-lite','gemini-3.5-flash']) LOOP
    FOR v_offset IN 0..900 BY 100 LOOP
      v_body := jsonb_build_object(
        'variant', jsonb_build_object(
          'test_set_label', 'motorsport_v3_large_2026-05',
          'sport_category', 'motorsport_v3',
          'ai_model_override', v_model,
          'notes', v_notes_tag
        ),
        'chunk_offset', v_offset,
        'chunk_limit', 100
      );
      SELECT net.http_post(v_url, v_body, '{}'::jsonb, v_headers, 300000) INTO v_req_id;
      RAISE NOTICE 'Queued model=% offset=% request_id=%', v_model, v_offset, v_req_id;
    END LOOP;
  END LOOP;
END $$;

-- Poll progress:
-- SELECT variant_ai_model_override AS model,
--        COUNT(*) FILTER (WHERE status='running') AS running,
--        COUNT(*) FILTER (WHERE status='completed') AS completed,
--        COUNT(*) FILTER (WHERE status='partial') AS partial,
--        COUNT(*) FILTER (WHERE status='failed') AS failed,
--        SUM(cases_run) AS total_cases_run,
--        SUM(cases_correct) AS total_correct,
--        ROUND(100.0 * SUM(cases_correct)::numeric / NULLIF(SUM(cases_run),0), 2) AS accuracy_pct,
--        SUM(total_cost_usd) AS total_cost_usd,
--        ROUND(AVG(total_latency_ms::numeric / NULLIF(cases_run,0)), 0) AS avg_latency_ms_per_case
-- FROM regression_benchmark_runs
-- WHERE variant_notes LIKE '%gemini_3.1_vs_3.5_comparison_2026-05-19%'
-- GROUP BY variant_ai_model_override
-- ORDER BY variant_ai_model_override;
