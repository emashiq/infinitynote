-- A sticky's default text color (v0.2.0): NULL is Automatic (dark or light ink from the background), else #rrggbb.
-- Sticky background colors stay in notes.color, which already holds any text: a preset name or a custom #rrggbb.
ALTER TABLE notes ADD COLUMN text_color TEXT CHECK (text_color IS NULL OR (length(text_color) = 7 AND text_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'));
