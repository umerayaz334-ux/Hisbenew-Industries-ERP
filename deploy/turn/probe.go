package main

import (
	"fmt"
	"net"
	"time"

	"github.com/pion/turn/v5"
)

// probe sends synthetic packets in both directions through two allocations.
func probe(address string, secret []byte, tcp bool) error {
	username := fmt.Sprintf("%d:healthcheck", time.Now().Add(time.Minute).Unix())
	allocate := func() (net.PacketConn, func(), error) {
		var socket net.PacketConn
		if tcp {
			conn, err := net.DialTimeout("tcp4", address, 5*time.Second)
			if err != nil {
				return nil, nil, err
			}
			socket = turn.NewSTUNConn(conn)
		} else {
			conn, err := net.ListenPacket("udp4", "0.0.0.0:0")
			if err != nil {
				return nil, nil, err
			}
			socket = conn
		}
		client, err := turn.NewClient(&turn.ClientConfig{Conn: socket, TURNServerAddr: address, STUNServerAddr: address, Username: username, Password: credential(secret, username), Realm: "hisbenew.com", RTO: time.Second})
		if err != nil {
			socket.Close()
			return nil, nil, err
		}
		cleanup := func() { client.Close(); socket.Close() }
		if err = client.Listen(); err != nil {
			cleanup()
			return nil, nil, err
		}
		relay, err := client.Allocate()
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		return relay, func() { relay.Close(); cleanup() }, nil
	}
	first, closeFirst, err := allocate()
	if err != nil {
		return err
	}
	defer closeFirst()
	second, closeSecond, err := allocate()
	if err != nil {
		return err
	}
	defer closeSecond()
	first.SetReadDeadline(time.Now().Add(5 * time.Second))
	second.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err = first.WriteTo([]byte("permission"), second.LocalAddr()); err != nil {
		return err
	}
	if _, err = second.WriteTo([]byte("reply"), first.LocalAddr()); err != nil {
		return err
	}
	buffer := make([]byte, 100)
	n, _, err := first.ReadFrom(buffer)
	if err != nil {
		return err
	}
	if string(buffer[:n]) != "reply" {
		return fmt.Errorf("unexpected relay response")
	}
	if _, err = first.WriteTo([]byte("return"), second.LocalAddr()); err != nil {
		return err
	}
	for {
		n, _, err = second.ReadFrom(buffer)
		if err != nil {
			return err
		}
		if string(buffer[:n]) == "return" {
			return nil
		}
	}
}
