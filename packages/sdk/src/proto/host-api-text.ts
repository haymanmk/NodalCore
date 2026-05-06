/**
 * Embedded copy of `host_api.proto`. Bundled into the SDK so consumers can
 * load it without depending on a specific filesystem layout (the source
 * .proto file is still shipped at packages/sdk/src/proto/host_api.proto for
 * non-JS plugin authors).
 *
 * Keep in sync with src/proto/host_api.proto. The integration smoke test in
 * commit 4 verifies the embedded copy compiles to the same service def.
 */
export const HOST_API_PROTO_TEXT = `syntax = "proto3";

package nodalcore.host.v1;

option java_package = "io.nodalcore.host.v1";
option java_multiple_files = true;

service HostAPI {
  rpc Request(HostRequest) returns (HostResponse);
}

message HostRequest {
  string plugin_id = 1;
  string method    = 2;
  string args_json = 3;
}

message HostResponse {
  string result_json = 1;
  string error       = 2;
}
`
