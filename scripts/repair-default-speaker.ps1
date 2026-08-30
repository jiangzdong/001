param([ValidateRange(0,100)][int]$MinimumVolume = 80)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public enum AudioDataFlow { Render, Capture, All }
public enum AudioRole { Console, Multimedia, Communications }

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(AudioDataFlow dataFlow, uint stateMask, out object devices);
  int GetDefaultAudioEndpoint(AudioDataFlow dataFlow, AudioRole role, out IMMDevice endpoint);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid interfaceId, uint classContext, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr notify);
  int UnregisterControlChangeNotify(IntPtr notify);
  int GetChannelCount(out uint count);
  int SetMasterVolumeLevel(float levelDb, Guid eventContext);
  int SetMasterVolumeLevelScalar(float level, Guid eventContext);
  int GetMasterVolumeLevel(out float levelDb);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint channel, float levelDb, Guid eventContext);
  int SetChannelVolumeLevelScalar(uint channel, float level, Guid eventContext);
  int GetChannelVolumeLevel(uint channel, out float levelDb);
  int GetChannelVolumeLevelScalar(uint channel, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid eventContext);
  int GetMute(out bool mute);
}

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager2 {
  int GetAudioSessionControl(ref Guid sessionGuid, uint streamFlags, out IntPtr sessionControl);
  int GetSimpleAudioVolume(ref Guid sessionGuid, uint streamFlags, out IntPtr simpleAudioVolume);
  int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnumerator);
}

[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionEnumerator {
  int GetCount(out int count);
  int GetSession(int index, out IAudioSessionControl sessionControl);
}

[ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl {
  int GetState(out int state);
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
  int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, Guid eventContext);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
  int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, Guid eventContext);
  int GetGroupingParam(out Guid groupingId);
  int SetGroupingParam(Guid groupingId, Guid eventContext);
  int RegisterAudioSessionNotification(IntPtr client);
  int UnregisterAudioSessionNotification(IntPtr client);
}

[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl2 {
  int GetState(out int state);
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
  int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, Guid eventContext);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
  int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, Guid eventContext);
  int GetGroupingParam(out Guid groupingId);
  int SetGroupingParam(Guid groupingId, Guid eventContext);
  int RegisterAudioSessionNotification(IntPtr client);
  int UnregisterAudioSessionNotification(IntPtr client);
  int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionIdentifier);
  int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionInstanceIdentifier);
  int GetProcessId(out uint processId);
}

[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISimpleAudioVolume {
  int SetMasterVolume(float level, Guid eventContext);
  int GetMasterVolume(out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid eventContext);
  int GetMute(out bool mute);
}

public static class DefaultSpeakerRepair {
  public static float[] Repair(float minimumLevel) {
    var enumerator = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorComObject();
    IMMDevice endpoint;
    var result = enumerator.GetDefaultAudioEndpoint(AudioDataFlow.Render, AudioRole.Multimedia, out endpoint);
    if (result != 0 || endpoint == null) throw new InvalidOperationException("Cannot read the default multimedia output endpoint. HRESULT=" + result);
    var volumeInterfaceId = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    object volumeObject;
    result = endpoint.Activate(ref volumeInterfaceId, 23, IntPtr.Zero, out volumeObject);
    if (result != 0 || volumeObject == null) throw new InvalidOperationException("Cannot activate the default endpoint volume. HRESULT=" + result);
    var volume = (IAudioEndpointVolume)volumeObject;
    float beforeLevel;
    bool beforeMuted;
    volume.GetMasterVolumeLevelScalar(out beforeLevel);
    volume.GetMute(out beforeMuted);
    var targetLevel = Math.Max(beforeLevel, minimumLevel);
    volume.SetMute(false, Guid.Empty);
    volume.SetMasterVolumeLevelScalar(targetLevel, Guid.Empty);
    float afterLevel;
    bool afterMuted;
    volume.GetMasterVolumeLevelScalar(out afterLevel);
    volume.GetMute(out afterMuted);
    return new [] { beforeLevel, beforeMuted ? 1f : 0f, afterLevel, afterMuted ? 1f : 0f };
  }

  public static string[] RepairAppSessions() {
    var lines = new List<string>();
    var enumerator = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorComObject();
    IMMDevice endpoint;
    var result = enumerator.GetDefaultAudioEndpoint(AudioDataFlow.Render, AudioRole.Multimedia, out endpoint);
    if (result != 0 || endpoint == null) throw new InvalidOperationException("Cannot read the default multimedia output endpoint. HRESULT=" + result);
    var managerInterfaceId = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    object managerObject;
    result = endpoint.Activate(ref managerInterfaceId, 23, IntPtr.Zero, out managerObject);
    if (result != 0 || managerObject == null) throw new InvalidOperationException("Cannot activate the audio session manager. HRESULT=" + result);
    IAudioSessionEnumerator sessionEnumerator;
    ((IAudioSessionManager2)managerObject).GetSessionEnumerator(out sessionEnumerator);
    int count;
    sessionEnumerator.GetCount(out count);
    for (var index = 0; index < count; index++) {
      IAudioSessionControl control;
      if (sessionEnumerator.GetSession(index, out control) != 0 || control == null) continue;
      var unknown = Marshal.GetIUnknownForObject(control);
      IntPtr control2Pointer = IntPtr.Zero;
      IntPtr volumePointer = IntPtr.Zero;
      try {
        var control2Id = new Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D");
        var volumeId = new Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8");
        if (Marshal.QueryInterface(unknown, ref control2Id, out control2Pointer) != 0 || control2Pointer == IntPtr.Zero) continue;
        var control2 = (IAudioSessionControl2)Marshal.GetObjectForIUnknown(control2Pointer);
        uint processId;
        if (control2.GetProcessId(out processId) != 0 || processId == 0) continue;
        string processName;
        try { processName = Process.GetProcessById((int)processId).ProcessName; } catch { continue; }
        if (!processName.Equals("electron", StringComparison.OrdinalIgnoreCase) && processName.IndexOf("小安", StringComparison.OrdinalIgnoreCase) < 0 && processName.IndexOf("XiaoAn", StringComparison.OrdinalIgnoreCase) < 0) continue;
        if (Marshal.QueryInterface(unknown, ref volumeId, out volumePointer) != 0 || volumePointer == IntPtr.Zero) continue;
        var volume = (ISimpleAudioVolume)Marshal.GetObjectForIUnknown(volumePointer);
        float beforeLevel;
        bool beforeMuted;
        volume.GetMasterVolume(out beforeLevel);
        volume.GetMute(out beforeMuted);
        volume.SetMute(false, Guid.Empty);
        volume.SetMasterVolume(1f, Guid.Empty);
        lines.Add(processName + " PID=" + processId + " volume=" + Math.Round(beforeLevel * 100) + "% muted=" + beforeMuted + " -> volume=100% muted=false");
      } finally {
        if (volumePointer != IntPtr.Zero) Marshal.Release(volumePointer);
        if (control2Pointer != IntPtr.Zero) Marshal.Release(control2Pointer);
        Marshal.Release(unknown);
      }
    }
    return lines.ToArray();
  }
}
"@

$state = [DefaultSpeakerRepair]::Repair([single]($MinimumVolume / 100.0))
[pscustomobject]@{
  BeforeVolumePercent = [Math]::Round($state[0] * 100)
  BeforeMuted = [bool]$state[1]
  AfterVolumePercent = [Math]::Round($state[2] * 100)
  AfterMuted = [bool]$state[3]
}
[DefaultSpeakerRepair]::RepairAppSessions()
