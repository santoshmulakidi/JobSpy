# API Reference

## `POST /collect`

```json
{
  "search_term": "Senior .NET Developer",
  "location": "Texas",
  "sites": ["linkedin", "indeed"],
  "results_wanted": 100,
  "country_indeed": "usa",
  "is_remote": false
}
```

## `GET /jobs`

Query parameters:

- `keyword`
- `company`
- `location`
- `remote`
- `min_salary`
- `max_salary`
- `limit`
- `offset`

## `POST /search`

Same filters as `GET /jobs`, supplied as JSON.
