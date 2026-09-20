abi <abi/4.0>,
include <tunables/global>

profile creator-agency /opt/Creator\ Agency/creator-agency flags=(unconfined) {
  userns,
  include if exists <local/creator-agency>
}
