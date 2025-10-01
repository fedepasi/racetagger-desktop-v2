-- Verifica se l'utente esiste già nella tabella admin_users
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = '12ad7060-5914-4868-b162-9b846580af21') THEN
        -- Inserisci l'utente specificato come amministratore
        INSERT INTO admin_users (user_id)
        VALUES ('12ad7060-5914-4868-b162-9b846580af21');
    END IF;
END $$;

-- Verifica che l'utente sia stato inserito correttamente
SELECT * FROM admin_users WHERE user_id = '12ad7060-5914-4868-b162-9b846580af21';
