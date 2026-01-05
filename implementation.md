# Vivd: Product Roadmap

### Feature Licensing System

> Control what each instance can do (env-first, license-server later)

**Restricted features**:

| Feature                | Env Var | Default                              |
| ---------------------- | ------- | ------------------------------------ |
| `LICENSE_IMAGE_GEN`    | `true`  | Image generation enabled             |
| `LICENSE_MAX_PROJECTS` | `1`     | Sites per instance (1 for customers) |
| `LICENSE_MAX_USERS`    | `3`     | Team members                         |

**AI rate limits**:

| Env Var                        | Default    | Purpose           |
| ------------------------------ | ---------- | ----------------- |
| `LICENSE_AI_TOKENS_PER_MINUTE` | `500000`   | Burst protection  |
| `LICENSE_AI_TOKENS_PER_MONTH`  | `10000000` | Monthly cap       |
| `LICENSE_AI_REQUESTS_PER_DAY`  | `200`      | Request throttle  |
| `LICENSE_IMAGE_GEN_PER_DAY`    | `20`       | Daily image limit |
| `LICENSE_IMAGE_GEN_PER_MONTH`  | `50`       | Monthly image cap |

**Tasks**:

- [ ] Create `LicenseService` in backend
  - [ ] Read limits from env vars
  - [ ] Check limits before operations
  - [ ] Return 402/upgrade-required when exceeded
- [ ] **Token tracking**:
  - [ ] Hook into OpenCode task events
  - [ ] Store cumulative usage per month in DB
- [ ] **Image generation tracking**:
  - [ ] Wrap image gen calls with counter
- [ ] Frontend: show usage stats in admin dashboard
- [ ] Frontend: graceful "limit reached" messaging

**Future**: Add license server verification for non-managed customers

## Future Enhancements

- [ ] **Template gallery**: Pre-built starting points
- [ ] **Customer billing dashboard**: If moving to self-service
- [ ] **License server**: For non-managed deployments
- [ ] **Master dashboard**: Your view across all customer instances
