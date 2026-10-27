ALTER TABLE refreshes ADD COLUMN warnings TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings));
