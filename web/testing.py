import serial, time
s = serial.Serial("/dev/cu.usbmodem169222501", 115200, timeout=0.1)
s.reset_input_buffer()
for cmd in (b"PING\n", b"INFO\n"):
    s.write(cmd); s.flush()
    end = time.time() + 1.5
    print("sent", cmd)
    while time.time() < end:
        line = s.readline().decode(errors="replace").strip()
        if line and not line.startswith("T,"):
            print("   got", repr(line))
s.close()
