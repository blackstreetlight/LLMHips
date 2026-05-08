#pragma once
#include<fltKernel.h>


NTSTATUS Ring3Event2Ring0Event(HANDLE* Ring3Event,
	ULONG32 Ring3EventLength, HANDLE* Ring0Event);

