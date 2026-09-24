abi <abi/4.0>,
include <tunables/global>

profile aquora /opt/Aquora/aquora flags=(unconfined) {
  userns,
  include if exists <local/aquora>
}
