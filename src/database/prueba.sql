ALTER TABLE organizaciones ADD COLUMN tema VARCHAR(50) DEFAULT 'tema1' NOT NULL;
ALTER TABLE organizaciones ADD CONSTRAINT tema_valido 
  CHECK (tema IN ('tema1', 'tema2', 'tema3', 'tema4'));