-- Properties already found before shared ownership was excluded at ingest; ones Ed has triaged are left alone.
UPDATE "flats"."properties"
SET "status" = 'rejected', "rejected_reason" = 'Shared ownership'
WHERE "shared_ownership" AND "status" = 'new';
