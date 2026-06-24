package welfare

import "testing"

func TestBuildRedPacketPacketsKeepsExactTotal(t *testing.T) {
	packets, err := buildRedPacketPackets(100, 12)
	if err != nil {
		t.Fatalf("build red packet packets failed: %v", err)
	}
	if len(packets) != 12 {
		t.Fatalf("expected 12 packets, got %d", len(packets))
	}
	if total := sumRedPacketPackets(packets); total != 100 {
		t.Fatalf("expected total 100, got %d packets=%v", total, packets)
	}
	for _, packet := range packets {
		if packet <= 0 {
			t.Fatalf("packet should be positive: %v", packets)
		}
	}
}

func TestBuildRedPacketPacketsRejectsTotalSmallerThanSlots(t *testing.T) {
	if _, err := buildRedPacketPackets(3, 5); err == nil || err.Error() != "红包总积分不能小于可参与人数" {
		t.Fatalf("expected total smaller than slots error, got %v", err)
	}
}
